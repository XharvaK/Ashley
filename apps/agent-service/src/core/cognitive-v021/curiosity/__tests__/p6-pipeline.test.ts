import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../../db.js";
import { recordSuccessfulRead } from "../../../curiosity/reads.js";
import { insertItem, insertTake, upsertSource } from "../../../curiosity/feed.js";
import {
  FROZEN_AUTOMATIC_ADMISSION_ALLOWLIST,
} from "../../memory/admission-allowlist.js";
import { MEMORY_KINDS } from "../../memory/kinds.js";
import { admitTestCycle, openTestSidecar } from "../../test-support.js";
import { buildThoughtInput } from "../../thought/input.js";

const identity = {
  constitutional: ["truth first"],
  stableSelf: ["curious"],
};
const capability = {
  vision: false,
  attachmentText: false,
  conversationalRead: false,
  webSearch: false,
  canOfferProjectInspection: false,
  canOfferWorkspace: false,
  canOfferVerification: false,
  canOfferAuthorship: false,
  canOfferBoundedOperation: false,
  canOfferPatchExport: false,
  approvedProjectIds: [],
};

function buildInput(sidecar: DatabaseSync, nuclear: DatabaseSync) {
  const cycle = admitTestCycle(sidecar, {
    cycleId: "p6-cycle",
    conversationId: "p6-conversation",
    triggerKind: "owner_message",
    triggerRef: "p6-owner",
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  return buildThoughtInput({
    sidecar,
    cycle,
    triggerText: "inspect grounded source continuity",
    constitution: identity,
    capabilityReality: capability,
    workingContext: [],
    occupancy: [],
    learnedSelfSlice: { dispositions: [], interests: [] },
    authorityDb: nuclear,
  });
}

function count(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

describe("MAT-P6 governed curiosity pipeline", () => {
  it("keeps the curiosity admission class closed and the current loop authoritative", () => {
    expect(FROZEN_AUTOMATIC_ADMISSION_ALLOWLIST).toEqual(["learned_self_evidence"]);
    expect(MEMORY_KINDS).not.toContain("curiosity" as never);

    const serveSource = readFileSync(new URL("../../../../serve.ts", import.meta.url), "utf8");
    expect(serveSource).toContain("startInboxConsumer");
    expect(serveSource).not.toContain("legacyRuntimeAllowed");
    expect(serveSource).not.toContain("startNuclearCuriosityLoop");

    const adapterSource = readFileSync(new URL("../own-time-adapter.ts", import.meta.url), "utf8");
    const inputSource = readFileSync(new URL("../../thought/input.ts", import.meta.url), "utf8");
    expect(adapterSource + "\n" + inputSource).not.toMatch(/ThoughtDurableNomination|insertTake|cur_takes/);

    const readsSource = readFileSync(new URL("../../../curiosity/reads.ts", import.meta.url), "utf8");
    expect(readsSource).not.toMatch(/discord|sendMessage|outbox/);
  });

  it("keeps grounded reads below C2 and does not fabricate a curiosity nomination", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const sourceId = upsertSource(nuclear, {
        slug: "p6-source",
        title: "P6 source",
        kind: "rss",
        url: "https://public.test/feed",
        interest: "systems",
      });
      const itemId = insertItem(nuclear, {
        sourceId,
        url: "https://public.test/article",
        title: "Grounded article",
        excerpt: "A grounded source excerpt.",
        interest: "systems",
      });
      if (itemId === null) throw new Error("p6_item_missing");
      const readId = recordSuccessfulRead(nuclear, {
        itemId,
        finalUrl: "https://public.test/article",
        contentHash: "a".repeat(64),
        model: "deterministic-html-extractor-v1",
        evidenceExcerpts: ["Grounded source evidence."],
        cleanedChars: 128,
        provenance: "shadow",
      });
      expect(readId).toBeGreaterThan(0);
      const takeId = insertTake(nuclear, {
        itemId,
        interest: "systems",
        take: "Dormant historical curiosity take.",
        evidenceKind: "read_record",
        readId,
        provenance: "shadow",
      });
      expect(takeId).toBeGreaterThan(0);

      const nominationsBefore = count(sidecar, "SELECT COUNT(*) AS count FROM durable_nominations");
      const input = buildInput(sidecar, nuclear);
      const serialized = JSON.stringify(input);

      expect(serialized).not.toContain("Dormant historical curiosity take");
      expect(input).not.toHaveProperty("curiosity");
      expect(input.domainPointers.pointers.some((pointer) => pointer.domain === "curiosity")).toBe(false);
      expect(count(sidecar, "SELECT COUNT(*) AS count FROM durable_nominations")).toBe(nominationsBefore);
      expect(count(nuclear, "SELECT COUNT(*) AS count FROM cur_takes WHERE provenance = 'live'")).toBe(0);
      expect(nuclear.prepare("SELECT final_url FROM cur_reads WHERE id = ?").get(readId))
        .toMatchObject({ final_url: "https://public.test/article" });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("projects an explicit session boundary and fail-soft store state without elapsed-time activity", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const input = buildInput(sidecar, nuclear);
      expect(input.domainPointers.pointers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          domain: "own_time",
          canonicalStore: "nuclear.db:own_time_sessions",
          status: "empty",
          disposition: "EMPTY",
          entityIds: [],
        }),
      ]));

      nuclear.exec("DROP TABLE own_time_sessions");
      const failedInput = buildInput(sidecar, nuclear);
      expect(failedInput.domainPointers.pointers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          domain: "own_time",
          status: "unreachable",
          disposition: "UNREACHABLE",
          entityIds: [],
        }),
      ]));
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});
