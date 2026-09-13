import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { AshleyCore } from "../runtime.js";
import { recordIdentityEntry, listIdentity } from "../identity/store.js";
import { applyEligibleRevisions, proposeRevision } from "../learning/revisions.js";
import { applyAffectiveEvent, getAffectiveState } from "../state/affect.js";
import { listActiveMindStateItems, upsertMindStateItem } from "../state/mind-items.js";
import { listActiveFacts, upsertFact } from "./facts.js";
import { getHotMessages, insertMessage, resolveActiveThread } from "./threads.js";
import {
  createEpisode,
  forgetEpisodesByTopic,
  listUnconsolidatedMessages,
  retrieveEpisodes,
} from "./episodes.js";

describe("episodic memory", () => {
  it("retrieves grounded episodes and removes forgotten callbacks", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const threadId = resolveActiveThread(db, "doc");
    const first = insertMessage(db, {
      threadId,
      ownerId: "doc",
      role: "user",
      text: "My modular synth performance is next Friday.",
    });
    const second = insertMessage(db, {
      threadId,
      ownerId: "doc",
      role: "assistant",
      text: "I want to hear how the synth performance goes.",
    });
    const episode = createEpisode(db, {
      ownerId: "doc",
      threadId,
      summary: "Doc has a modular synth performance next Friday and Ashley wants to revisit it.",
      entities: ["modular synth", "performance"],
      messageIds: [first, second],
      salience: 0.9,
      unresolved: true,
    });

    expect(episode?.sourceStartMessageId).toBe(first);
    expect(retrieveEpisodes(db, "doc", "How did the synth show go?")[0]?.id).toBe(episode?.id);
    expect(forgetEpisodesByTopic(db, "doc", "synth")).toBe(1);
    expect(retrieveEpisodes(db, "doc", "synth")).toHaveLength(0);
    db.close();
  });

  it("treats LIKE wildcard characters as literal forget text", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const threadId = resolveActiveThread(db, "doc");
    const one = insertMessage(db, {
      threadId, ownerId: "doc", role: "user", text: "100% ready",
    });
    const two = insertMessage(db, {
      threadId, ownerId: "doc", role: "assistant", text: "noted",
    });
    createEpisode(db, {
      ownerId: "doc", threadId, summary: "The release is 100% ready.",
      messageIds: [one],
    });
    createEpisode(db, {
      ownerId: "doc", threadId, summary: "An unrelated ordinary episode.",
      messageIds: [two],
    });
    expect(forgetEpisodesByTopic(db, "doc", "%")).toBe(1);
    expect(retrieveEpisodes(db, "doc", "")).toHaveLength(1);
    db.close();
  });

  it("preserves an automatic fact while independent evidence remains", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const threadId = resolveActiveThread(db, "doc");
    const firstMessage = insertMessage(db, {
      threadId,
      ownerId: "doc",
      role: "user",
      text: "The codename is Orchid.",
    });
    const firstReply = insertMessage(db, {
      threadId,
      ownerId: "doc",
      role: "assistant",
      text: "Understood.",
    });
    const secondMessage = insertMessage(db, {
      threadId,
      ownerId: "doc",
      role: "user",
      text: "The codename is Orchid.",
    });
    const secondReply = insertMessage(db, {
      threadId,
      ownerId: "doc",
      role: "assistant",
      text: "Still noted.",
    });
    const forgotten = createEpisode(db, {
      ownerId: "doc",
      threadId,
      summary: "The secret launch codename is Orchid.",
      messageIds: [firstMessage, firstReply],
    })!;
    const retained = createEpisode(db, {
      ownerId: "doc",
      threadId,
      summary: "Doc repeated the project codename Orchid.",
      messageIds: [secondMessage, secondReply],
    })!;
    const factId = upsertFact(db, {
      ownerId: "doc",
      category: "project",
      key: "codename",
      value: "Orchid",
      origin: "explicit_user",
      sourceMessageId: firstMessage,
      sourceQuote: "The codename is Orchid.",
    });
    const link = db.prepare(
      `INSERT INTO evidence_links
         (owner_id, target_type, target_id, source_type, source_id, created_at)
       VALUES ('doc', 'fact', ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    link.run(String(factId), "episode", String(forgotten.id), now);
    link.run(String(factId), "message", String(firstMessage), now);
    link.run(String(factId), "episode", String(retained.id), now);
    link.run(String(factId), "message", String(secondMessage), now);

    expect(forgetEpisodesByTopic(db, "doc", "secret")).toBe(1);
    expect(listActiveFacts(db, "doc")).toEqual([
      expect.objectContaining({
        id: factId,
        sourceMessageId: secondMessage,
        origin: "explicit_user",
      }),
    ]);
    db.close();
  });

  it("cascades forgotten evidence without touching manual memory", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const core = new AshleyCore(db);
    const threadId = resolveActiveThread(db, "doc");
    const ids = [
      insertMessage(db, { threadId, ownerId: "doc", role: "user", text: "The codename is Orchid." }),
      insertMessage(db, { threadId, ownerId: "doc", role: "assistant", text: "Understood." }),
      insertMessage(db, { threadId, ownerId: "doc", role: "user", text: "The private launch still matters." }),
      insertMessage(db, { threadId, ownerId: "doc", role: "assistant", text: "I'll keep that in mind." }),
    ];
    const first = createEpisode(db, {
      ownerId: "doc",
      threadId,
      summary: "A secret launch uses the codename Orchid.",
      messageIds: ids.slice(0, 2),
      provenance: "live",
    })!;
    const second = createEpisode(db, {
      ownerId: "doc",
      threadId,
      summary: "The secret launch remains important.",
      messageIds: ids.slice(2),
      provenance: "live",
    })!;
    const factId = upsertFact(db, {
      ownerId: "doc",
      category: "project",
      key: "codename",
      value: "Orchid",
      confidence: 1,
      importance: 90,
      sourceMessageId: ids[0],
      origin: "explicit_user",
      sourceQuote: "The codename is Orchid.",
    });
    upsertFact(db, {
      ownerId: "doc",
      category: "pinned",
      key: "manual_safeguard",
      value: "keep this",
      origin: "manual",
    });
    const link = db.prepare(
      `INSERT INTO evidence_links
         (owner_id, target_type, target_id, source_type, source_id, created_at)
       VALUES ('doc', ?, ?, ?, ?, ?)`,
    );
    link.run("fact", String(factId), "episode", String(first.id), new Date().toISOString());
    link.run("fact", String(factId), "message", String(ids[0]), new Date().toISOString());
    upsertMindStateItem(db, {
      ownerId: "doc",
      kind: "concern",
      text: "Protect the launch details.",
      sourceType: "episode",
      sourceId: first.id,
      urgency: 0.9,
    });
    applyAffectiveEvent(db, {
      ownerId: "doc",
      sourceType: "episode",
      sourceId: first.id,
      tensionDelta: 0.2,
      reason: "Protecting a secret launch.",
    });
    recordIdentityEntry(db, {
      ownerId: "doc",
      layer: "dynamic",
      kind: "interest.launches",
      text: "manual baseline",
      source: "manual",
    });
    const revisionBase = {
      ownerId: "doc",
      targetLayer: "dynamic_identity" as const,
      targetKey: "interest.launches",
      proposedValue: "careful with private launches",
      rationale: "Repeated evidence.",
      evidenceType: "episode",
      provenance: "live" as const,
    };
    const revisionId = proposeRevision(db, { ...revisionBase, evidenceId: first.id });
    proposeRevision(db, { ...revisionBase, evidenceId: second.id });
    expect(applyEligibleRevisions(db, "doc", "apply")).toEqual([revisionId]);
    const job = db.prepare(
      `INSERT INTO cognitive_jobs
         (owner_id, kind, source_key, payload_json, status, attempts,
          available_at, created_at, updated_at)
       VALUES ('doc', 'consolidate_thread', 'forget-test', '{}', 'completed', 1,
               ?, ?, ?)`,
    ).run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    db.prepare(
      `INSERT INTO cognitive_runs
         (job_id, owner_id, kind, input_json, output_json, status, created_at, episode_id)
       VALUES (?, 'doc', 'consolidate_thread', '{}', '{"secret":"Orchid"}',
               'completed', ?, ?)`,
    ).run(Number(job.lastInsertRowid), new Date().toISOString(), first.id);

    const preview = core.forget("doc", "secret", false);
    expect(preview.preview.length).toBeGreaterThan(1);
    expect(preview.previewId).toBeTruthy();
    core.forget("doc", "", true, { previewId: preview.previewId });

    expect(listActiveFacts(db, "doc").map((fact) => fact.key)).toEqual([
      "manual_safeguard",
    ]);
    expect(listActiveMindStateItems(db, "doc")).toHaveLength(0);
    expect(getAffectiveState(db, "doc").reason).toBe("neutral baseline");
    expect(listIdentity(db, "doc", { layer: "dynamic" })).toEqual(
      expect.arrayContaining([expect.objectContaining({
        kind: "interest.launches",
        text: "manual baseline",
        source: "manual",
      })]),
    );
    expect(db.prepare(
      "SELECT status FROM learning_revisions WHERE id = ?",
    ).get(revisionId)).toMatchObject({ status: "reverted" });
    expect(db.prepare(
      "SELECT output_json FROM cognitive_runs WHERE episode_id = ?",
    ).get(first.id)).toMatchObject({ output_json: "{}" });
    db.close();
  });

  it("redacts matching messages and returns a content-free receipt", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const core = new AshleyCore(db);
    const threadId = resolveActiveThread(db, "doc");
    const userId = insertMessage(db, {
      threadId,
      ownerId: "doc",
      role: "user",
      text: "The codename is Orchid.",
    });
    const assistantId = insertMessage(db, {
      threadId,
      ownerId: "doc",
      role: "assistant",
      text: "I will remember the project detail.",
    });
    createEpisode(db, {
      ownerId: "doc",
      threadId,
      summary: "A project detail should remain available.",
      messageIds: [userId, assistantId],
    });

    const preview = core.forget("doc", "Orchid", false);
    expect(preview.previewId).toBeTruthy();
    const result = core.forget("doc", "", true, { previewId: preview.previewId });

    expect(result).toMatchObject({
      preview: [],
      receiptId: expect.any(String),
      counts: {
        messagesRedacted: 1,
        episodesForgotten: 1,
      },
    });
    expect(JSON.stringify(result)).not.toContain("Orchid");
    expect(getHotMessages(db, threadId).map((message) => message.id))
      .toEqual([assistantId]);
    expect(listUnconsolidatedMessages(db, "doc", threadId).map((message) => message.id))
      .toEqual([]);
    expect(db.prepare(
      `SELECT text, redacted_at, redaction_receipt_id
       FROM mem_messages WHERE id = ?`,
    ).get(userId)).toMatchObject({
      text: "",
      redacted_at: expect.any(String),
      redaction_receipt_id: result.receiptId,
    });
    expect(db.prepare(
      "SELECT owner_id, messages_redacted FROM forget_receipts WHERE id = ?",
    ).get(result.receiptId)).toMatchObject({
      owner_id: "doc",
      messages_redacted: 1,
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("immediately disables recall when deletion integrity cannot be proven", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const core = new AshleyCore(db);
    const threadId = resolveActiveThread(db, "doc");
    insertMessage(db, {
      threadId,
      ownerId: "doc",
      role: "user",
      text: "The codename is Orchid.",
    });
    db.exec(`
      CREATE TRIGGER defeat_redaction
      AFTER UPDATE OF redacted_at ON mem_messages
      WHEN NEW.redacted_at IS NOT NULL
      BEGIN
        UPDATE mem_messages
        SET text = OLD.text, redacted_at = NULL, redaction_receipt_id = NULL
        WHERE id = NEW.id;
      END;
    `);

    const preview = core.forget("doc", "Orchid", false);
    expect(() =>
      core.forget("doc", "", true, { previewId: preview.previewId }),
    ).toThrow("forget_integrity_failed:message");
    expect(core.getCapabilities().capabilities.find(
      (capability) => capability.capability === "recall",
    )).toMatchObject({
      state: "disabled",
      failureKind: "deletion_integrity",
    });
    db.close();
  });
});
