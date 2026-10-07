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

  it("matches parameterised admin paths and nothing else", () => {
    expect(isAdminRoute("POST", "/nuclear/identity/proposals/abc-123/approve")).toBe(true);
    expect(isAdminRoute("POST", "/nuclear/identity/proposals/abc-123/withdraw")).toBe(false);
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
    const originalToken = process.env.DISCORD_BOT_TOKEN;
    try {
      env.discordOwnerId = "";
      delete process.env.DISCORD_BOT_TOKEN;
      const { ok, errors } = validateBoot();
      expect(ok).toBe(false);
      expect(errors.join(" ")).toMatch(/DISCORD_OWNER_ID missing/);
      expect(errors.join(" ")).toMatch(/DISCORD_BOT_TOKEN missing/);
    } finally {
      env.discordOwnerId = originalOwner;
      if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
      else process.env.DISCORD_BOT_TOKEN = originalToken;
    }
  });
});
