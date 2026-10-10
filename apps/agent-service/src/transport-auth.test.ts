import express from "express";
import type { Server } from "node:http";
import { describe, expect, it } from "vitest";
import { routeSurface } from "./route-surface.js";
import {
  ACTOR_HEADER,
  ADMIN_ROUTES,
  BOT_SERVICE_HEADER,
  createTransportAuth,
  isAdminRoute,
  sameSecret,
} from "./transport-auth.js";

const TOKEN = "transport-test-token";
const OWNER = "owner-1";

async function withApp(
  options: { serviceToken: string; ownerId: string },
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(createTransportAuth(options));
  app.use((_req, res) => { res.status(200).json({ reached: true }); });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no_address");
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("bot → agent transport authentication", () => {
  it("leaves only /health open", async () => {
    await withApp({ serviceToken: TOKEN, ownerId: OWNER }, async (url) => {
      expect((await fetch(`${url}/health`)).status).toBe(200);
      expect((await fetch(`${url}/memory/summary?owner_id=${OWNER}`)).status).toBe(401);
      expect((await fetch(`${url}/shutdown`, { method: "POST" })).status).toBe(401);
    });
  });

  it("refuses a forged service token", async () => {
    await withApp({ serviceToken: TOKEN, ownerId: OWNER }, async (url) => {
      const forged = await fetch(`${url}/chat/ingress`, {
        method: "POST",
        headers: { [BOT_SERVICE_HEADER]: "not-the-token" },
      });
      expect(forged.status).toBe(401);
      const ok = await fetch(`${url}/chat/ingress`, {
        method: "POST",
        headers: { [BOT_SERVICE_HEADER]: TOKEN },
      });
      expect(ok.status).toBe(200);
    });
  });

  it("refuses everything when the agent has no service token", async () => {
    await withApp({ serviceToken: "", ownerId: OWNER }, async (url) => {
      const response = await fetch(`${url}/chat/ingress`, {
        method: "POST",
        headers: { [BOT_SERVICE_HEADER]: "" },
      });
      expect(response.status).toBe(401);
    });
  });

  it("lets only the Owner actor reach an admin route, whatever the body says", async () => {
    await withApp({ serviceToken: TOKEN, ownerId: OWNER }, async (url) => {
      const post = (headers: Record<string, string>) => fetch(`${url}/memory/forget`, {
        method: "POST",
        headers: { "content-type": "application/json", [BOT_SERVICE_HEADER]: TOKEN, ...headers },
        body: JSON.stringify({ userId: OWNER, topic: "anything" }),
      });
      expect((await post({})).status).toBe(403);
      expect((await post({ [ACTOR_HEADER]: "contact-7" })).status).toBe(403);
      expect((await post({ [ACTOR_HEADER]: OWNER })).status).toBe(200);
    });
  });

  it("fails admin closed when no Owner is configured", async () => {
    await withApp({ serviceToken: TOKEN, ownerId: "" }, async (url) => {
      const response = await fetch(`${url}/initiative/pause`, {
        method: "POST",
        headers: { [BOT_SERVICE_HEADER]: TOKEN, [ACTOR_HEADER]: "" },
      });
      expect(response.status).toBe(403);
    });
  });

  it("compares a presented secret against the expected one without a length or prefix shortcut", () => {
    expect(sameSecret("svc-token-1", "svc-token-1")).toBe(true);
    expect(sameSecret("svc-token-2", "svc-token-1")).toBe(false);
    expect(sameSecret("svc-token", "svc-token-1")).toBe(false);
    expect(sameSecret("", "svc-token-1")).toBe(false);
  });

  it("matches parameterised admin paths and nothing else", () => {
    expect(isAdminRoute("POST", "/nuclear/external/actions/abc-123/cancel")).toBe(true);
    expect(isAdminRoute("POST", "/nuclear/external/actions/abc-123/reconcile")).toBe(false);
    expect(isAdminRoute("GET", "/memory/forget")).toBe(false);
    expect(isAdminRoute("POST", "/memory/forget/")).toBe(true);
    // A3: only the Owner grants or revokes a trusted contact.
    expect(isAdminRoute("POST", "/social/contacts")).toBe(true);
    expect(isAdminRoute("POST", "/social/contacts/revoke")).toBe(true);
    expect(isAdminRoute("POST", "/social/contacts/teacher")).toBe(true);
    expect(isAdminRoute("POST", "/places/switch")).toBe(true);
    expect(isAdminRoute("POST", "/quiet")).toBe(true);
    expect(isAdminRoute("POST", "/quiet/dnd")).toBe(true);
    expect(isAdminRoute("POST", "/quiet/presence")).toBe(true);
    expect(isAdminRoute("DELETE", "/quiet")).toBe(true);
    expect(isAdminRoute("GET", "/quiet")).toBe(true);
    expect(isAdminRoute("GET", "/quiet/dnd")).toBe(false);
  });

  it("matches admin paths whatever the letter case, and treats HEAD as GET", () => {
    expect(isAdminRoute("POST", "/QUIET")).toBe(true);
    expect(isAdminRoute("POST", "/Memory/Forget")).toBe(true);
    expect(isAdminRoute("POST", "/NUCLEAR/External/Actions/abc-123/CANCEL")).toBe(true);
    expect(isAdminRoute("GET", "/Quiet")).toBe(true);
    expect(isAdminRoute("HEAD", "/quiet")).toBe(true);
    expect(isAdminRoute("HEAD", "/QUIET/")).toBe(true);
  });

  it("refuses case-folded and HEAD admin requests that lack the Owner actor", async () => {
    await withApp({ serviceToken: TOKEN, ownerId: OWNER }, async (url) => {
      const auth = { [BOT_SERVICE_HEADER]: TOKEN };
      expect((await fetch(`${url}/QUIET`, { method: "POST", headers: auth })).status).toBe(403);
      expect((await fetch(`${url}/Memory/Forget`, { method: "POST", headers: auth })).status).toBe(403);
      expect((await fetch(`${url}/quiet`, { method: "HEAD", headers: auth })).status).toBe(403);
      expect((await fetch(`${url}/quiet`, { method: "HEAD", headers: { ...auth, [ACTOR_HEADER]: OWNER } })).status).toBe(200);
    });
  });

  it("treats pause, resume and shutdown as Owner acts, like their peer controls", () => {
    expect(isAdminRoute("POST", "/pause")).toBe(true);
    expect(isAdminRoute("POST", "/resume")).toBe(true);
    expect(isAdminRoute("POST", "/shutdown")).toBe(true);
    expect(isAdminRoute("POST", "/initiative/pause")).toBe(true);
  });

  it("puts the Owner-judgment mutations that take a body user id in the admin tier", () => {
    for (const path of [
      "/nuclear/temporal",
      "/nuclear/relationship/c5",
      "/nuclear/memory/corrections",
      "/nuclear/capabilities/memory-evidence/evaluation",
      "/growth/dimensions/seed",
      "/growth/dimensions/revert",
      "/initiative/clock/reconcile",
    ]) {
      expect(isAdminRoute("POST", path), path).toBe(true);
    }
  });

  it("puts the owner-only reads of her places, contacts and clock state in the admin tier", () => {
    expect(isAdminRoute("GET", "/places")).toBe(true);
    expect(isAdminRoute("GET", "/social/contacts")).toBe(true);
  });

  it("classifies every active owner-required mutation as an admin act or a reviewed route", () => {
    // ownerScope is the declared contract; this makes it bind. A new owner-required
    // mutation must be added to ADMIN_ROUTES or to the reviewed list below.
    const reviewed = new Set([
      // Owner-body mutation outside the eight in A13-5; decision pending.
      "POST /nuclear/external/actions/:entityUuid/reconcile",
      // Bot-internal: called by the Discord bot's own pipeline, not by an Owner act.
      "POST /chat/ingress",
      "POST /delivery/claim",
      "POST /delivery/:id/receipt",
      "POST /delivery/:id/recheck-external",
      "POST /delivery/:id/recheck-owner-room",
      "POST /delivery/:id/auxiliary",
      "POST /delivery/:id/dispatch-started",
      "POST /delivery/:id/finalize",
      "POST /soft/claim",
      "POST /soft/:id/result",
      "POST /domus/snapshots/claim",
      "POST /domus/snapshots/:id/result",
      "POST /signals/reaction",
      "POST /signals/gif-feedback",
      "POST /signals/emoji-weight",
      "POST /memory/pin",
      "POST /memory/newthread",
      "POST /cancel",
      "POST /discord/public-presence/projection-receipt",
      "POST /initiative/idle",
      "POST /initiative/scheduler/ack",
    ]);
    const admin = new Set(ADMIN_ROUTES.map(([method, path]) => `${method} ${path}`));
    const unclassified = routeSurface
      .filter((entry) => entry.lifecycle === "active" && entry.ownerScope === "owner_required"
        && entry.method !== "GET")
      .map((entry) => `${entry.method} ${entry.path}`)
      .filter((key) => !admin.has(key) && !reviewed.has(key));
    expect(unclassified).toEqual([]);
  });

  it("names only routes the agent actually serves", () => {
    const served = new Set(routeSurface
      .filter((entry) => entry.lifecycle !== "retired")
      .map((entry) => `${entry.method} ${entry.path}`));
    for (const [method, path] of ADMIN_ROUTES) {
      expect(served.has(`${method} ${path}`), `${method} ${path}`).toBe(true);
    }
  });
});

describe("Owner configuration at boot", () => {
  it("refuses to boot without an Owner or a service token", async () => {
    const { env, validateBoot } = await import("./env.js");
    const originalOwner = env.discordOwnerId;
    const originalServiceToken = env.agentServiceToken;
    try {
      env.discordOwnerId = "";
      env.agentServiceToken = "";
      const { ok, errors } = validateBoot();
      expect(ok).toBe(false);
      expect(errors.join(" ")).toMatch(/DISCORD_OWNER_ID missing/);
      expect(errors.join(" ")).toMatch(/ASHLEY_SERVICE_TOKEN or DISCORD_BOT_TOKEN missing/);
    } finally {
      env.discordOwnerId = originalOwner;
      env.agentServiceToken = originalServiceToken;
    }
  });
});
