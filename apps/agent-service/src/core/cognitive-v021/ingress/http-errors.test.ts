import express from "express";
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createCognitiveIngressHandler } from "./http.js";
import { openTestSidecar } from "../test-support.js";
import { openNuclearDb } from "../../db.js";
import { AppError } from "../../../errors.js";

async function postIngress(
  authorizeOwner: (userId: string) => void,
  body: Record<string, unknown>,
): Promise<{ status: number; body: { error?: string; code?: string } }> {
  const sidecar = openTestSidecar();
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  const app = express();
  app.use(express.json());
  app.post("/chat/ingress", createCognitiveIngressHandler({
    sidecar,
    nuclearDb: nuclear,
    authorizeOwner,
  }));
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address_missing");
    const res = await fetch(`http://127.0.0.1:${address.port}/chat/ingress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as { error?: string; code?: string } };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    nuclear.close();
    sidecar.close();
  }
}

describe("cognitive ingress error mapping (A13-12)", () => {
  it("keeps a refused owner check at 403 with a short code", async () => {
    const result = await postIngress(() => {
      throw new AppError("forbidden", "Forbidden", 403);
    }, { userId: "someone-else", message: "hello" });
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "forbidden", code: "forbidden" });
  });

  it("maps a missing owner id to 403", async () => {
    const result = await postIngress(() => undefined, { message: "hello" });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("forbidden");
  });

  it("maps bad input to 400 with the input code", async () => {
    const result = await postIngress(() => undefined, { userId: "doc" });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "message_required", code: "message_required" });
  });

  it("maps an oversized message to 400 with the input code", async () => {
    const result = await postIngress(() => undefined, { userId: "doc", message: "x".repeat(4001) });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "message_too_long", code: "message_too_long" });
  });

  it("maps an internal failure to 500 without echoing the raw message", async () => {
    const result = await postIngress(() => {
      throw new Error("SQLITE_BUSY: database is locked at an internal path");
    }, { userId: "doc", message: "hello" });
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "internal_error", code: "internal_error" });
    expect(JSON.stringify(result.body)).not.toContain("SQLITE");
  });
});
