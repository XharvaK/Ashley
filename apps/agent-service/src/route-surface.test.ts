import express from "express";
import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { AgentManager } from "./agent.js";
import { assertRegisteredRoutes, routeSurface } from "./route-surface.js";
import { createServer } from "./server.js";
import { env } from "./env.js";
import { openCognitiveSidecarDb } from "./core/cognitive-v021/sidecar/db.js";
import { openObservabilityStore, RAW_DEBUG_RETENTION_MAX_MS } from "./core/cognitive-v021/thought/diagnostics.js";
import type { Server } from "node:http";

async function startTestServer(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test_server_address_unavailable");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function stopTestServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe("route surface registry", () => {
  it("includes the dedicated C1 control-plane routes without a witness insertion route", () => {
    const keys = routeSurface.map((entry) => `${entry.method} ${entry.path}`);
    expect(keys).toEqual(expect.arrayContaining([
      "POST /nuclear/capabilities/memory-evidence/qualification-epoch/start",
      "GET /nuclear/capabilities/memory-evidence/qualification-epochs",
      "POST /nuclear/capabilities/memory-evidence/evaluation",
      "GET /nuclear/capabilities/memory-evidence/readiness",
      "POST /nuclear/capabilities/memory-evidence/cutover",
      "POST /initiative/periodic/debug/enable",
      "GET /initiative/periodic/diagnostics",
    ]));
    expect(keys.some((key) => key.includes("memory-evidence/witness"))).toBe(false);
  });

  it("accepts an app whose registered routes match the registry", () => {
    const app = express();
    for (const entry of routeSurface) {
      const handler = (_req: express.Request, res: express.Response) => {
        res.status(entry.lifecycle === "retired" ? 410 : 200).end();
      };
      if (entry.method === "GET") app.get(entry.path, handler);
      else if (entry.method === "POST") app.post(entry.path, handler);
      else if (entry.method === "PUT") app.put(entry.path, handler);
      else if (entry.method === "PATCH") app.patch(entry.path, handler);
      else app.delete(entry.path, handler);
    }
    expect(() => assertRegisteredRoutes(app)).not.toThrow();
  });

  it("rejects route drift", () => {
    const app = express();
    app.get("/health", (_req, res) => res.end());
    expect(() => assertRegisteredRoutes(app)).toThrow(/route_surface_drift/);
  });

  it("keeps the live server registration aligned with the registry", () => {
    expect(() => createServer({} as AgentManager)).not.toThrow();
  });

  it("routes explicit C5 admission through the owner-authenticated runtime seam", async () => {
    const ownerId = env.discordOwnerId || "route-test-owner";
    let captured: Record<string, unknown> | null = null;
    const manager = {
      core: {
        recordC5AshleySelfCommitment(input: Record<string, unknown>) {
          captured = input;
          return { entityUuid: "c5-route-fixture" };
        },
      },
    } as unknown as AgentManager;
    const { server, url } = await startTestServer(createServer(manager));
    try {
      const denied = await fetch(`${url}/nuclear/relationship/c5`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "self_commitment" }),
      });
      expect(denied.status).toBe(403);

      const response = await fetch(`${url}/nuclear/relationship/c5`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: ownerId,
          operation: "self_commitment",
          text: "Ashley will keep this bounded.",
          sourceEntityType: "decision",
          sourceEntityUuid: "decision:route-fixture",
          decisionId: 1,
          evidenceRefs: [{ type: "decision", id: 1 }],
          classification: "ordinary",
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        operation: "self_commitment",
        result: { entityUuid: "c5-route-fixture" },
      });
      expect(captured).toMatchObject({
        ownerId,
        hostValidationOk: true,
      });
      expect(captured).not.toHaveProperty("capabilityMode");
    } finally {
      await stopTestServer(server);
    }
  });

  it("keeps retired legacy chat, curiosity, and proactive entry points inert", async () => {
    const originalDiscordOwnerId = env.discordOwnerId;
    const originalMemoryOwnerId = env.memoryOwnerId;
    const manager = {
      getCognitiveKernel: () => "v021" as const,
      getState: () => "ready" as const,
      isPaused: () => false,
      core: {
      },
    } as unknown as AgentManager;
    env.discordOwnerId = "doc";
    env.memoryOwnerId = "doc";
    const { server, url } = await startTestServer(createServer(manager));
    try {
      const requests = await Promise.all([
        fetch(`${url}/chat/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "doc", message: "must use ingress" }),
        }),
        fetch(`${url}/curiosity/tick`, { method: "POST" }),
        fetch(`${url}/initiative/tick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "doc" }),
        }),
        fetch(`${url}/initiative/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "doc" }),
        }),
        fetch(`${url}/initiative/commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: "doc",
            reservationId: 1,
            text: "legacy commit",
            threadId: "thread",
            discordMessageId: "discord-message",
          }),
        }),
      ]);
      for (const response of requests) {
        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({ code: "endpoint_retired" });
      }
    } finally {
      await stopTestServer(server);
      env.discordOwnerId = originalDiscordOwnerId;
      env.memoryOwnerId = originalMemoryOwnerId;
    }
  });

  it("routes owner clock reconciliation through the owner-authenticated route seam", async () => {
    const originalDiscordOwnerId = env.discordOwnerId;
    const ownerId = "route-test-owner";
    env.discordOwnerId = ownerId;
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    const manager = {
      dataPlane: { kind: "isolated", cognitiveSidecarDbPath: ":memory:" },
      getCognitiveSidecar: () => sidecar,
    } as unknown as AgentManager;
    const { server, url } = await startTestServer(createServer(manager, { cognitiveSidecar: sidecar }));
    try {
      // 1. Unauthenticated / non-owner denied with 403
      const denied = await fetch(`${url}/initiative/clock/reconcile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "impostor", authorizationRef: "owner:test" }),
      });
      expect(denied.status).toBe(403);

      // 2. Missing authorizationRef rejected with 400
      const missingAuth = await fetch(`${url}/initiative/clock/reconcile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: ownerId }),
      });
      expect(missingAuth.status).toBe(400);
      expect(await missingAuth.json()).toMatchObject({ code: "message_required" });

      // 3. Authenticated owner with authorizationRef reconciles clock and persists evidence
      const response = await fetch(`${url}/initiative/clock/reconcile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: ownerId,
          wallClockNowMs: 5_000_000,
          authorizationRef: "owner:forced-clock-recovery-witness",
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        policyId: "ashley.private_thought.v1",
        policyTimeMs: 5_000_000,
      });

      // Verify sidecar persisted the exact reconciliation reference and timestamp
      const row = sidecar.prepare("SELECT * FROM private_budget_policy_clock WHERE policy_id = 'ashley.private_thought.v1'").get() as Record<string, unknown>;
      expect(row).toMatchObject({
        clock_state: "stable",
        last_policy_now_ms: 5_000_000,
        reconciled_at_ms: 5_000_000,
        reconciliation_ref: "owner:forced-clock-recovery-witness",
      });
    } finally {
      await stopTestServer(server);
      sidecar.close();
      env.discordOwnerId = originalDiscordOwnerId;
    }
  });

  it("keeps periodic debug enablement and diagnostics owner-authenticated", async () => {
    const originalDiscordOwnerId = env.discordOwnerId;
    const originalMode = process.env.ASHLEY_OBSERVABILITY_MODE;
    const ownerId = "route-test-owner";
    env.discordOwnerId = ownerId;
    process.env.ASHLEY_OBSERVABILITY_MODE = "rich";
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    const observability = openObservabilityStore(":memory:");
    const manager = {
      dataPlane: { kind: "isolated", cognitiveSidecarDbPath: ":memory:" },
      getCognitiveSidecar: () => sidecar,
    } as unknown as AgentManager;
    const { server, url } = await startTestServer(createServer(manager, {
      cognitiveSidecar: sidecar,
      observabilityDb: observability.db,
    }));
    try {
      const denied = await fetch(`${url}/initiative/periodic/debug/enable`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "impostor", occurrence_id: "occ-route" }),
      });
      expect(denied.status).toBe(403);

      const missingOccurrence = await fetch(`${url}/initiative/periodic/debug/enable`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: ownerId }),
      });
      expect(missingOccurrence.status).toBe(400);

      const enabled = await fetch(`${url}/initiative/periodic/debug/enable`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: ownerId,
          occurrence_id: "occ-route",
          ttl_ms: RAW_DEBUG_RETENTION_MAX_MS * 2,
        }),
      });
      expect(enabled.status).toBe(200);
      expect(await enabled.json()).toMatchObject({
        ok: true,
        occurrenceId: "occ-route",
        captureMode: "rich",
      });
      const captureRow = observability.db.prepare(
        "SELECT enabled_at_ms, expires_at_ms, enabled_by, capture_mode FROM thought_debug_captures WHERE occurrence_id = ?",
      ).get("occ-route") as Record<string, unknown>;
      expect(captureRow.enabled_by).toBe(ownerId);
      expect(captureRow.capture_mode).toBe("rich");
      expect(Number(captureRow.expires_at_ms) - Number(captureRow.enabled_at_ms)).toBe(RAW_DEBUG_RETENTION_MAX_MS);

      const readDenied = await fetch(`${url}/initiative/periodic/diagnostics?owner_id=impostor`);
      expect(readDenied.status).toBe(403);
      const read = await fetch(`${url}/initiative/periodic/diagnostics?owner_id=${encodeURIComponent(ownerId)}`);
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ ok: true, diagnostics: [] });
    } finally {
      await stopTestServer(server);
      observability.close();
      sidecar.close();
      env.discordOwnerId = originalDiscordOwnerId;
      if (originalMode === undefined) delete process.env.ASHLEY_OBSERVABILITY_MODE;
      else process.env.ASHLEY_OBSERVABILITY_MODE = originalMode;
    }
  });
});
