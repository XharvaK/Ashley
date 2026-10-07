/**
 * Tripwire: Domus ingress must not write Ashley's affect, mind state,
 * relationship, commitments, or social authority. A perception may be stored
 * as an observation; only a later Thought pass may author on it.
 * Checks: deny list is alive, static reachability, no raw SQL to deny tables,
 * runtime row digests stay put. Update the deny list only with an Owner-reviewed reason.
 */
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { createDomusIngressApp } from "./ingress.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const WRITERS: Record<string, readonly string[]> = {
  "core/state/affect.ts": ["getAffectiveState", "applyAffectiveEvent", "decayAffect", "attachAffectLicense"],
  "core/state/mind-items.ts": [
    "upsertMindStateItem", "claimUrgentMindState", "consumeUrgentWake", "retryUrgentWake",
    "resolveMindStateItem", "cancelMindStateItem", "resolveMindStateBySource", "applyMindStateDispositions",
  ],
};

const MODULE_DENY = [
  "core/memory/fanout.ts",
  "core/relationship/store.ts",
  "core/relationship/claims.ts",
  "core/relationship/tensions.ts",
  "core/relationship/self-commitments.ts",
  "core/relationship/projections.ts",
  "core/relationship/transitions.ts",
  "core/relationship/authority.ts",
  "core/relationship/consent.ts",
  "core/relationship/interaction-contracts.ts",
  "core/relationship/repair.ts",
  "core/relationship/forget.ts",
  "core/relationship/control-admission.ts",
  "core/relationship/commitment-admission.ts",
  "core/relationship/social-authority.ts",
];

const DENY_MODULES = [...Object.keys(WRITERS), ...MODULE_DENY];

const DENY_TABLES = [
  "affective_events", "affective_state", "mind_state_items", "memory_assertions",
  "memory_correction_outcomes", "memory_correction_receipts", "memory_correction_targets",
  "memory_corrections", "memory_reconciliation_requests", "doc_reminders",
  "relationship_motivation_claims", "relational_tensions", "ashley_self_commitments",
  "relationship_projections", "mutual_commitments", "withdrawal_records", "consent_records",
  "interaction_contracts", "repair_adjudications", "repair_evidence", "repair_proposals",
  "decision_log", "motivations", "control_settlements", "owner_prohibitions", "social_permits",
  "trusted_rooms", "commitment_settlements", "ashley_boundaries", "disclosure_licenses",
  "recipient_restrictions", "social_operation_delegations",
];

const INBOX_WAKE_TABLES = ["inbox_events", "wakes", "wake_legacy_quarantine", "wakes_v12"];

// growing it requires keeping the deny checks green and an Architect-reviewed reason
// 2026-10-07: endings.ts, the plain reading of a finished act, reached from acts.ts and feed.ts
const MAX_INGRESS_CLOSURE = 9;

const SQL_DENY = new RegExp(
  `\\b(INSERT(\\s+OR\\s+\\w+)?\\s+INTO|UPDATE|DELETE\\s+FROM|REPLACE\\s+INTO)\\s+["\`]?(${DENY_TABLES.join("|")})["\`]?\\b`,
  "i",
);

const TOKEN = "h".repeat(32);
const BOT = "b".repeat(32);
const NOW = 1_700_000_000_000;

function posix(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function codeOf(file: string): string {
  return stripComments(fs.readFileSync(file, "utf8")).replace(/\bimport\s+type\b[\s\S]*?;/g, "");
}

function specifiers(code: string): string[] {
  const found: string[] = [];
  const from = /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g;
  const side = /^\s*import\s*["']([^"']+)["']/gm;
  const dynamic = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of code.matchAll(from)) found.push(match[1]);
  for (const match of code.matchAll(side)) found.push(match[1]);
  for (const match of code.matchAll(dynamic)) found.push(match[1]);
  return found;
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const abs = path.resolve(path.dirname(fromFile), spec);
  const candidates = spec.endsWith(".js")
    ? [abs.replace(/\.js$/, ".ts"), abs.replace(/\.js$/, "/index.ts")]
    : [abs.endsWith(".ts") ? abs : `${abs}.ts`, path.join(abs, "index.ts")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`unresolved relative import ${spec} from ${posix(fromFile)}; update the walker`);
}

function closure(entryRel: string): string[] {
  const seen = new Set<string>();
  const queue = [path.join(SRC, entryRel)];
  while (queue.length) {
    const file = queue.pop()!;
    const rel = posix(file);
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const spec of specifiers(codeOf(file))) {
      const next = resolveSpecifier(file, spec);
      if (next) queue.push(next);
    }
  }
  return [...seen].sort();
}

const ingressClosure = closure("core/domus/ingress.ts");
const undoClosure = closure("core/cognitive-v021/memory/undo.ts");
console.info(`domus ingress closure (${ingressClosure.length}): ${ingressClosure.join(", ")}`);

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1, observation_id: "obs-1", world: "world", branch: "branch", session: "session",
    attachment: "attachment", body: "body", snapshot: "snapshot", seq: 1,
    source_time_ms: NOW - 1_000, expires_at_ms: NOW + 60_000, lineage_class: "WORLD_LINE",
    percepts: [{ kind: "light", salience: 0.5, facts: { n: 1 } }],
    ...overrides,
  };
}

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address_missing");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function post(base: string, route: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["X-Domus-Token"] = token;
  return fetch(`${base}${route}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function existingTables(db: DatabaseSync, names: readonly string[]): string[] {
  const rows = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${names.map(() => "?").join(",")})`,
  ).all(...names) as Array<{ name: string }>;
  return names.filter((name) => rows.some((row) => row.name === name));
}

function digestTable(db: DatabaseSync, table: string): { count: number; digest: string } {
  const count = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n);
  const rows = db.prepare(`SELECT rowid AS _rowid, * FROM "${table}" ORDER BY rowid`).all();
  return { count, digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}

describe("deny list is alive", () => {
  it("every deny module exists and named writers are still exported functions", async () => {
    for (const rel of DENY_MODULES) {
      expect(fs.existsSync(path.join(SRC, rel)), `${rel} is missing; update the deny list`).toBe(true);
    }
    const loaded: Record<string, Record<string, unknown>> = {
      "core/state/affect.ts": await import("../state/affect.js"),
      "core/state/mind-items.ts": await import("../state/mind-items.js"),
    };
    for (const [rel, names] of Object.entries(WRITERS)) {
      const imported = loaded[rel];
      expect(imported, `${rel} is not loaded; update the deny list`).toBeTruthy();
      for (const name of names) {
        expect(typeof imported[name], `${rel} no longer exports ${name}; update the deny list`).toBe("function");
      }
    }
  });
});

describe("static reachability", () => {
  it("ingress closure stays small and includes no deny module", () => {
    expect(ingressClosure.length, ingressClosure.join("\n")).toBeLessThanOrEqual(MAX_INGRESS_CLOSURE);
    const hit = ingressClosure.filter((rel) => DENY_MODULES.includes(rel));
    expect(hit, `deny module reachable: ${hit.join(", ")}`).toEqual([]);
  });

  it("undo closure includes no deny module", () => {
    const hit = undoClosure.filter((rel) => DENY_MODULES.includes(rel));
    expect(hit, `deny module reachable from undo: ${hit.join(", ")}`).toEqual([]);
  });

  it("memory/redacted.ts has no imports", () => {
    const text = codeOf(path.join(SRC, "core/cognitive-v021/memory/redacted.ts"));
    expect(text).not.toMatch(/\bimport\b/);
    expect(text).not.toMatch(/\brequire\s*\(/);
    expect(text).not.toMatch(/\bfrom\s+["']/);
  });
});

describe("no raw SQL to deny tables", () => {
  it("the identifier boundary rejects sidecar_memory_assertions and accepts memory_assertions", () => {
    expect(SQL_DENY.test("UPDATE sidecar_memory_assertions SET x=1")).toBe(false);
    expect(SQL_DENY.test("UPDATE memory_assertions SET x=1")).toBe(true);
  });

  it("no reachable file writes a deny table", () => {
    const hits: string[] = [];
    for (const rel of ingressClosure) {
      const code = codeOf(path.join(SRC, rel));
      if (SQL_DENY.test(code)) hits.push(rel);
    }
    expect(hits, `deny-table SQL in ${hits.join(", ")}`).toEqual([]);
  });
});

describe("runtime trap", () => {
  it("ingress exercise leaves deny, inbox, and wake rows unchanged", async () => {
    const db = openTestSidecar();
    const watched = [
      ...existingTables(db, DENY_TABLES),
      ...existingTables(db, INBOX_WAKE_TABLES),
    ];
    const before = new Map(watched.map((table) => [table, digestTable(db, table)]));
    const app = createDomusIngressApp({ db, token: TOKEN, botToken: BOT, now: () => NOW });
    const started = await listen(app);
    try {
      const admitted = await post(started.base, "/domus/observation", observation(), TOKEN);
      expect(admitted.status).toBe(202);
      const inboxBeforeThought = existingTables(db, INBOX_WAKE_TABLES).map((table) => [table, digestTable(db, table)] as const);
      // 8d will add a domus_notification inbox append, and when it does, the 8d packet must update this assertion consciously.
      for (const [table, shot] of inboxBeforeThought) {
        expect(shot).toEqual(before.get(table));
      }
      expect((await post(started.base, "/domus/observation", observation(), TOKEN)).status).toBe(200);
      expect((await post(started.base, "/domus/observation", observation({
        observation_id: "obs-stale", source_time_ms: NOW - 10_000, expires_at_ms: NOW - 1,
      }), TOKEN)).status).toBe(410);
      expect((await post(started.base, "/domus/heartbeat", {
        v: 1, helper_session: "helper-1", sent_at_ms: NOW, attached: true,
      }, TOKEN)).status).toBe(200);
      expect((await post(started.base, "/domus/undo", {
        v: 1, world: "world", branch: "branch", session: "session",
        after_source_time_ms: NOW - 2_000, reason: "RELOAD",
      }, TOKEN)).status).toBe(200);
      expect((await post(started.base, "/domus/observation", observation({ observation_id: "obs-401" }))).status).toBe(401);
      expect((await post(started.base, "/domus/observation", observation({ extra: 1, observation_id: "obs-400" }), TOKEN)).status).toBe(400);
      for (const [table, shot] of before) {
        expect(digestTable(db, table), table).toEqual(shot);
      }
    } finally {
      await new Promise<void>((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
      db.close();
    }
  });
});
