import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { AshleyCore } from "../runtime.js";
import { claimReactiveDelivery } from "../delivery/store.js";
import { insertMessage, resolveActiveThread } from "../memory/threads.js";
import {
  CLASSIFICATION_RANK,
  publicDisclosureTruth,
} from "../privacy/classification.js";
import {
  ALL_ETH_PUB_PROTECTED,
  evaluatePublicDisclosure,
} from "../privacy/disclosure.js";
import {
  CREDENTIAL_OMITTED_PLACEHOLDER,
  detectCredentialShape,
} from "../privacy/secrets.js";
import {
  createDualBackupPackage,
  verifyBackupPackage,
} from "./backup-package.js";
import {
  getAuthoritativeLineageId,
  openContinuityDb,
} from "./db.js";
import { legacyEntityUuid, newEntityUuid } from "./entity-uuid.js";
import { resolvePreviewByDiscordMessage } from "./forget-preview.js";
import {
  assertOutboundAllowed,
  assertWritebackAllowed,
  enterEvalForkMode,
  exitEvalForkMode,
} from "./process-guards.js";

const temps: string[] = [];

afterEach(() => {
  exitEvalForkMode();
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may still hold VACUUM handles briefly */
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ashley-w4-"));
  temps.push(dir);
  return dir;
}

describe("wave04 privacy lattice", () => {
  it("orders classification lattice", () => {
    expect(CLASSIFICATION_RANK.ordinary).toBeLessThan(
      CLASSIFICATION_RANK.sensitive,
    );
    expect(CLASSIFICATION_RANK.sensitive).toBeLessThan(
      CLASSIFICATION_RANK.never_public,
    );
    expect(CLASSIFICATION_RANK.never_public).toBeLessThan(
      CLASSIFICATION_RANK.secret,
    );
  });

  it("denies never_public, secret, and all ETH-PUB protected categories", () => {
    expect(
      publicDisclosureTruth("never_public", { hasProtectedCategory: false })
        .allowed,
    ).toBe(false);
    expect(
      publicDisclosureTruth("secret", { hasProtectedCategory: false }).allowed,
    ).toBe(false);
    for (const category of ALL_ETH_PUB_PROTECTED) {
      expect(
        evaluatePublicDisclosure({
          classification: "ordinary",
          protectedCategories: [category],
          thoughtAuthorized: true,
        }).allowed,
      ).toBe(false);
    }
  });

  it("detects credential shapes and ignores bare words", () => {
    expect(
      detectCredentialShape("we talked about the API token design").hit,
    ).toBe(false);
    expect(detectCredentialShape("password rotation policy").hit).toBe(false);
    const hit = detectCredentialShape(`ghp_${"a".repeat(36)}`);
    expect(hit.hit).toBe(true);
  });
});

describe("wave04 secret ingress", () => {
  it("stores placeholder and skips raw credential on claim", () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const token = `ghp_${"b".repeat(36)}`;
    const claim = claimReactiveDelivery(nuclear, {
      ownerId: "doc",
      channel: "discord",
      mergedUserText: `here is ${token}`,
      inboundDiscordMessageIds: ["m1"],
      finalFragmentReceivedAtMs: Date.now(),
    });
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") return;
    expect(claim.secretOmitted).toBe(true);
    const row = nuclear
      .prepare(
        `SELECT text, data_classification FROM mem_messages WHERE id = ?`,
      )
      .get(claim.reservation.userMessageId) as {
      text: string;
      data_classification: string;
    };
    expect(row.text).toBe(CREDENTIAL_OMITTED_PLACEHOLDER);
    expect(row.data_classification).toBe("secret");
    expect(JSON.stringify(row)).not.toContain(token);
  });
});

describe("wave04 entity_uuid + forget saga", () => {
  it("keeps sidecar lineage across nuclear replace", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const lineageId = getAuthoritativeLineageId(continuity);
    openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    expect(getAuthoritativeLineageId(continuity)).toBe(lineageId);
    expect(legacyEntityUuid(lineageId, "mem_messages", 1)).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(newEntityUuid()).not.toBe(
      legacyEntityUuid(lineageId, "mem_messages", 1),
    );
  });

  it("persists preview_id and confirms after Discord message rebind", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const core = new AshleyCore(nuclear);
    const thread = resolveActiveThread(nuclear, "doc");
    insertMessage(nuclear, {
      threadId: thread,
      ownerId: "doc",
      role: "user",
      text: "Orchid is private",
    });
    const preview = core.forget("doc", "Orchid", false);
    expect(preview.previewId).toBeTruthy();
    expect(preview.categoryCounts?.mem_messages).toBeGreaterThan(0);
    const discordMsg = "discord-confirm-1";
    core.bindForgetConfirmation("doc", preview.previewId!, discordMsg);
    const resolved = resolvePreviewByDiscordMessage(
      continuity,
      "doc",
      discordMsg,
    );
    expect(resolved).toBe(preview.previewId);
    const confirmed = core.forget("doc", "", true, {
      previewId: preview.previewId,
    });
    expect(confirmed.receiptId).toBeTruthy();
    expect(confirmed.honesty?.oldBackups).toMatch(/backup/i);
    const text = nuclear
      .prepare(
        `SELECT text FROM mem_messages WHERE owner_id = 'doc' AND text LIKE '%Orchid%'`,
      )
      .get();
    expect(text).toBeUndefined();
  });

  it("leaves post-preview records untouched", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const core = new AshleyCore(nuclear);
    const thread = resolveActiveThread(nuclear, "doc");
    insertMessage(nuclear, {
      threadId: thread,
      ownerId: "doc",
      role: "user",
      text: "alpha secret topic",
    });
    const preview = core.forget("doc", "alpha", false);
    insertMessage(nuclear, {
      threadId: thread,
      ownerId: "doc",
      role: "user",
      text: "alpha arrived after preview",
    });
    core.forget("doc", "", true, { previewId: preview.previewId });
    const remaining = nuclear
      .prepare(
        `SELECT text FROM mem_messages
         WHERE owner_id = 'doc' AND text LIKE '%after preview%' AND redacted_at IS NULL`,
      )
      .get() as { text: string } | undefined;
    expect(remaining?.text).toContain("after preview");
  });

  it("rejects topic-only destructive confirmation", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const core = new AshleyCore(nuclear);
    const thread = resolveActiveThread(nuclear, "doc");
    insertMessage(nuclear, {
      threadId: thread,
      ownerId: "doc",
      role: "user",
      text: "beta topic",
    });
    expect(() => core.forget("doc", "beta", true)).toThrow(
      /forget_preview_id_required/,
    );
  });

  it("fails closed when v13 nuclear meets empty sidecar", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const empty = openContinuityDb(new DatabaseSync(":memory:"));
    expect(() => openNuclearDb(nuclear, { continuity: empty })).toThrow(
      /continuity_lineage_missing|continuity_lineage_mismatch/,
    );
  });

  it("reuses lineage across remigration and keeps deterministic UUIDs", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = new DatabaseSync(":memory:");
    openNuclearDb(nuclear, { continuity });
    const lineageId = getAuthoritativeLineageId(continuity);
    const adoptions = continuity
      .prepare(
        `SELECT COUNT(*) AS c FROM continuity_events
         WHERE json_extract(detail_json, '$.event') = 'lineage_adoption'`,
      )
      .get() as { c: number };
    expect(Number(adoptions.c)).toBe(1);
    // Remigrate same handle (already v13) — no second adoption.
    openNuclearDb(nuclear, { continuity });
    expect(getAuthoritativeLineageId(continuity)).toBe(lineageId);
    const adoptions2 = continuity
      .prepare(
        `SELECT COUNT(*) AS c FROM continuity_events
         WHERE json_extract(detail_json, '$.event') = 'lineage_adoption'`,
      )
      .get() as { c: number };
    expect(Number(adoptions2.c)).toBe(1);
    expect(legacyEntityUuid(lineageId, "mem_messages", 42)).toBe(
      legacyEntityUuid(lineageId, "mem_messages", 42),
    );
  });

  it("enforces idempotent Discord bind and rejects conflicts", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const core = new AshleyCore(nuclear);
    const thread = resolveActiveThread(nuclear, "doc");
    insertMessage(nuclear, {
      threadId: thread,
      ownerId: "doc",
      role: "user",
      text: "gamma topic",
    });
    const preview = core.forget("doc", "gamma", false);
    core.bindForgetConfirmation("doc", preview.previewId!, "msg-1");
    core.bindForgetConfirmation("doc", preview.previewId!, "msg-1");
    expect(() =>
      core.bindForgetConfirmation("doc", preview.previewId!, "msg-2"),
    ).toThrow(/forget_preview_bind_conflict/);
    insertMessage(nuclear, {
      threadId: thread,
      ownerId: "doc",
      role: "user",
      text: "delta topic",
    });
    const other = core.forget("doc", "delta", false);
    expect(() =>
      core.bindForgetConfirmation("doc", other.previewId!, "msg-1"),
    ).toThrow(/forget_preview_discord_message_in_use/);
  });
});

describe("wave04 fork guards", () => {
  it("blocks mistral, http, and delivery writeback in eval fork mode", () => {
    enterEvalForkMode(tempDir());
    expect(() => assertOutboundAllowed("mistral")).toThrow(/outbound_blocked/);
    expect(() => assertOutboundAllowed("curiosity_http")).toThrow(
      /outbound_blocked/,
    );
    expect(() => assertWritebackAllowed("delivery_claim")).toThrow(
      /writeback_blocked/,
    );
  });
});

describe("wave04 backup package", () => {
  it("authenticates package and detects tamper", () => {
    const dir = tempDir();
    const nuclearPath = join(dir, "nuclear.db");
    const continuityPath = join(dir, "continuity.db");
    const continuity = openContinuityDb(new DatabaseSync(continuityPath));
    const nuclear = openNuclearDb(new DatabaseSync(nuclearPath), { continuity });
    const key = "a".repeat(64);
    const { packagePath } = createDualBackupPackage({
      nuclearDbPath: nuclearPath,
      continuityDbPath: continuityPath,
      continuity,
      outDir: join(dir, "out"),
      transferKeyHex: key,
      nuclearSchemaVersion: 13,
      continuitySchemaVersion: 1,
    });
    const manifest = verifyBackupPackage({
      packagePath,
      transferKeyHex: key,
      expectedLineageId: getAuthoritativeLineageId(continuity),
    });
    expect(manifest.nuclearHash).toMatch(/^[0-9a-f]{64}$/);
    const bytes = Buffer.from(readFileSync(packagePath));
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(packagePath, bytes);
    expect(() =>
      verifyBackupPackage({ packagePath, transferKeyHex: key }),
    ).toThrow(/backup_tamper_detected/);
    nuclear.close();
    continuity.close();
  });
});
