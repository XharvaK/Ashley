import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "./core/db.js";
import { listCapabilityStatuses } from "./core/rollout/capabilities.js";
import { createV021LiveOperationExecutors } from "./core/cognitive-v021/dispatch/live-operations.js";
import { getCapabilityReality } from "./core/cognitive-v021/thought/capability-reality.js";
import { openTestSidecar } from "./core/cognitive-v021/test-support.js";
import type { ObservationRequest } from "./core/cognitive-v021/types.js";

const SERVE_SOURCE = readFileSync(
  fileURLToPath(new URL("./serve.ts", import.meta.url)),
  "utf8",
);
const ENV_SOURCE = readFileSync(
  fileURLToPath(new URL("./env.ts", import.meta.url)),
  "utf8",
);

const OWNER_AUDIENCE = { kind: "owner_private" } as const;
const PARTICIPANT_AUDIENCE = { kind: "room", roomId: "room:guild:channel" } as const;

function maximallyAuthorisedDb(): DatabaseSync {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  listCapabilityStatuses(db, "apply");
  db.prepare("UPDATE capability_releases SET state = 'active'").run();
  return db;
}

function serveSourceCall(): string {
  const start = SERVE_SOURCE.indexOf("createV021LiveOperationExecutors({");
  expect(start).toBeGreaterThan(-1);
  const end = SERVE_SOURCE.indexOf("});", start);
  return SERVE_SOURCE.slice(start, end);
}

describe("R-4 shipping startup composition is default-off for perception", () => {
  it("supplies the live operation executors without any provider adapter", () => {
    const call = serveSourceCall();
    expect(call).toContain("nuclear");
    expect(call).toContain("ownerId");
    expect(call).toContain("sidecar");
    expect(call).not.toMatch(/\badapters\b/);
    expect(call).not.toMatch(/webSearchProvider\s*:/);
    expect(call).not.toMatch(/webFetchProvider\s*:/);
  });

  it("never constructs a provider instance in the shipping serve module", () => {
    expect(SERVE_SOURCE).not.toMatch(/\bnew\s+UnavailableWeb(Search|Fetch)Provider\b/);
    expect(SERVE_SOURCE).not.toMatch(/\bnew\s+\w*Web(Search|Fetch)Provider\b/);
    expect(SERVE_SOURCE).not.toMatch(/\bdefaultWeb(Search|Fetch)Provider\b/);
  });

  it("keeps the legacy perception turn stubbed out of the shipping path", () => {
    expect(SERVE_SOURCE).toMatch(/runPerception:\s*async\s*\(\)\s*=>\s*\[\]/);
  });

  it("refuses a web search through the shipping executor composition", async () => {
    const nuclear = maximallyAuthorisedDb();
    const sidecar = openTestSidecar();
    try {
      const executors = createV021LiveOperationExecutors({
        nuclear,
        ownerId: "default",
        sidecar,
      });
      const request: ObservationRequest = {
        requestId: "startup-search",
        cycleId: "cycle-startup",
        generation: 1,
        kind: "web.search",
        request: { query: "public topic" },
        replaySafe: true,
        audience: OWNER_AUDIENCE,
      };
      await expect(executors.executeObservation(request)).rejects.toThrow(
        /web_search_unavailable/,
      );
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("refuses a public page fetch through the shipping executor composition", async () => {
    const nuclear = maximallyAuthorisedDb();
    const sidecar = openTestSidecar();
    try {
      const executors = createV021LiveOperationExecutors({
        nuclear,
        ownerId: "default",
        sidecar,
      });
      const request: ObservationRequest = {
        requestId: "startup-fetch",
        cycleId: "cycle-startup",
        generation: 1,
        kind: "web.fetch",
        request: { url: "https://example.test/page" },
        replaySafe: true,
        audience: OWNER_AUDIENCE,
      };
      await expect(executors.executeObservation(request)).rejects.toThrow(
        /web_fetch_unavailable/,
      );
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("reports default-off capability truth for Owner and participant cycles alike", () => {
    const nuclear = maximallyAuthorisedDb();
    try {
      const processStart = getCapabilityReality(nuclear);
      expect(processStart.vision).toBe(false);
      expect(processStart.attachmentText).toBe(false);
      expect(processStart.conversationalRead).toBe(false);
      expect(processStart.webSearch).toBe(false);

      for (const audience of [OWNER_AUDIENCE, PARTICIPANT_AUDIENCE]) {
        const refreshed = getCapabilityReality(nuclear, { audience, nowMs: 10 });
        expect(refreshed.vision).toBe(false);
        expect(refreshed.attachmentText).toBe(false);
        expect(refreshed.conversationalRead).toBe(false);
        expect(refreshed.webSearch).toBe(false);
        expect(refreshed.reachability?.reasons).toMatchObject({
          vision: "capability_not_in_live_set",
          attachmentText: "capability_not_in_live_set",
          conversationalRead: "capability_not_in_live_set",
          webSearch: "capability_not_in_live_set",
        });
      }
    } finally {
      nuclear.close();
    }
  });

  it("exposes no environment path that could activate a perception capability", () => {
    expect(ENV_SOURCE).toMatch(
      /strictBoolean\("ASHLEY_COMMAND_CODE_WORKER_ENABLED",\s*false\)/,
    );
    const flags = [
      ...ENV_SOURCE.matchAll(/strictBoolean\(\s*"([^"]+)"\s*,\s*(true|false)\s*,?\s*\)/g),
    ];
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(flag[2]).toBe("false");
    }
    for (const forbidden of ["vision", "attachment", "perception", "web_search", "web_fetch", "conversational_read"]) {
      expect(flags.map((f) => f[1]?.toLowerCase() ?? "")).not.toContain(forbidden);
    }
  });
});
