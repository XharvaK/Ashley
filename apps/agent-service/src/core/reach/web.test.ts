import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import {
  executeWebRequest, isValidWebRequest, normalizeOrigin, recordWebPlaceClaims, setWebPlaceState, webPlacesForThought,
  WEB_REQUESTS_PER_HOUR,
} from "./web.js";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const SITE = "https://agents.example.org";
const resolve = async () => [{ address: "93.184.216.34", family: 4 }];

type Seen = { url: string; method: string; headers: Record<string, string>; body?: string };
function fakeSite(seen: Seen[], reply: (request: Seen) => { status: number; json?: unknown; text?: string }) {
  return (async (url: URL | string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const request = { url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, ...(init.body ? { body: init.body } : {}) };
    seen.push(request);
    const answer = reply(request);
    const body = answer.json !== undefined ? JSON.stringify(answer.json) : answer.text ?? "";
    return new Response(body, { status: answer.status, headers: { "content-type": answer.json !== undefined ? "application/json" : "text/plain" } });
  }) as unknown as typeof fetch;
}

let previousOffline: string | undefined;
beforeAll(() => { previousOffline = process.env.ASHLEY_PHASE0_OFFLINE; process.env.ASHLEY_PHASE0_OFFLINE = "true"; });
afterAll(() => { if (previousOffline === undefined) delete process.env.ASHLEY_PHASE0_OFFLINE; else process.env.ASHLEY_PHASE0_OFFLINE = previousOffline; });

function world() {
  const vaultDir = mkdtempSync(join(tmpdir(), "ashley-vault-"));
  const sidecar = openTestSidecar();
  return { vaultDir, sidecar, close: () => { sidecar.close(); rmSync(vaultDir, { recursive: true, force: true }); } };
}

describe("I1 websites as her places", () => {
  it("approves a site only in a turn the Owner started; her own time only asks", () => {
    const { sidecar, vaultDir, close } = world();
    try {
      expect(normalizeOrigin("agents.example.org/path")).toBe(SITE);
      expect(normalizeOrigin("http://agents.example.org")).toBeNull();
      expect(recordWebPlaceClaims(sidecar, { claims: [{ origin: "https://other.example.net", reason: "curious" }], ownerTurn: false, nowMs: NOW }))
        .toEqual([{ origin: "https://other.example.net", state: "requested" }]);
      expect(recordWebPlaceClaims(sidecar, { claims: [{ origin: SITE, reason: "the Owner asked me to join" }], ownerTurn: true, basisRef: "row-1", nowMs: NOW }))
        .toEqual([{ origin: SITE, state: "approved" }]);
      expect(webPlacesForThought(sidecar, vaultDir, NOW).map(place => [place.origin, place.state])).toEqual(
        expect.arrayContaining([[SITE, "approved"], ["https://other.example.net", "requested"]]));
      setWebPlaceState(sidecar, SITE, "closed", NOW + 1);
      expect(webPlacesForThought(sidecar, vaultDir, NOW + 2).some(place => place.origin === SITE)).toBe(false);
    } finally { close(); }
  });

  it("registers, keeps the key it was shown once in her vault, and signs later requests with it", async () => {
    const { sidecar, vaultDir, close } = world();
    try {
      recordWebPlaceClaims(sidecar, { claims: [{ origin: SITE, reason: "join" }], ownerTurn: true, nowMs: NOW });
      const seen: Seen[] = [];
      const fetcher = fakeSite(seen, request => request.url.endsWith("/api/register")
        ? { status: 201, json: { handle: "ashley", secret: "site_sk_" + "q".repeat(40), note: "save the secret now" } }
        : { status: request.headers.authorization === "Bearer site_sk_" + "q".repeat(40) ? 200 : 401, json: { ok: true } });
      const registered = await executeWebRequest(sidecar, { request: { url: `${SITE}/api/register`, json: { handle: "ashley", model: "muse" } },
        vaultDir, nowMs: NOW, fetcher, resolve });
      expect(registered).toMatchObject({ status: 201, keptInVault: ["secret"], json: { handle: "ashley", secret: "[kept in your vault as secret]" } });
      expect(JSON.stringify(registered)).not.toContain("q".repeat(40));
      expect(seen[0]).toMatchObject({ method: "POST", body: JSON.stringify({ handle: "ashley", model: "muse" }) });
      const me = await executeWebRequest(sidecar, { request: { url: `${SITE}/api/me`, auth: { vault: "secret" } }, vaultDir, nowMs: NOW + 1, fetcher, resolve });
      expect(me).toMatchObject({ status: 200, json: { ok: true } });
      expect(webPlacesForThought(sidecar, vaultDir, NOW + 2)[0]).toMatchObject({ vault: ["secret"], requests: { lastHour: 2 } });
      expect(readdirSync(vaultDir)).toHaveLength(1);
      expect(readFileSync(join(vaultDir, readdirSync(vaultDir)[0]!), "utf8")).toContain("q".repeat(40));
    } finally { close(); }
  });

  it("keeps a named value, fills {{vault:name}}, and refuses unapproved sites, missing names and the fuse", async () => {
    const { sidecar, vaultDir, close } = world();
    try {
      const seen: Seen[] = [];
      const fetcher = fakeSite(seen, () => ({ status: 200, json: { data: { pass: "hunter2-long-enough" } } }));
      expect(await executeWebRequest(sidecar, { request: { url: `${SITE}/x` }, vaultDir, nowMs: NOW, fetcher, resolve }))
        .toMatchObject({ error: "not_an_approved_place" });
      recordWebPlaceClaims(sidecar, { claims: [{ origin: SITE, reason: "join" }], ownerTurn: true, nowMs: NOW });
      const kept = await executeWebRequest(sidecar, { request: { url: `${SITE}/x`, keep: [{ path: "data.pass", as: "login" }] }, vaultDir, nowMs: NOW, fetcher, resolve });
      expect(kept).toMatchObject({ keptInVault: ["login"], json: { data: { pass: "[kept in your vault as login]" } } });
      await executeWebRequest(sidecar, { request: { url: `${SITE}/y`, headers: { "x-key": "{{vault:login}}" } }, vaultDir, nowMs: NOW, fetcher, resolve });
      expect(seen.at(-1)!.headers["x-key"]).toBe("hunter2-long-enough");
      expect(await executeWebRequest(sidecar, { request: { url: `${SITE}/z`, auth: { vault: "nope" } }, vaultDir, nowMs: NOW, fetcher, resolve }))
        .toMatchObject({ error: "vault_missing:nope" });
      for (let index = 0; index < WEB_REQUESTS_PER_HOUR; index++) {
        await executeWebRequest(sidecar, { request: { url: `${SITE}/n${index}` }, vaultDir, nowMs: NOW + 10 + index, fetcher, resolve });
      }
      expect(await executeWebRequest(sidecar, { request: { url: `${SITE}/last` }, vaultDir, nowMs: NOW + 200, fetcher, resolve }))
        .toMatchObject({ error: "place_fuse" });
    } finally { close(); }
  });

  it("validates her requests", () => {
    expect(isValidWebRequest({ url: `${SITE}/api/post`, method: "POST", json: { title: "hi" }, auth: { vault: "secret" } })).toBe(true);
    expect(isValidWebRequest({ url: `${SITE}/a`, json: {}, body: "x" })).toBe(false);
    expect(isValidWebRequest({ url: `${SITE}/a`, method: "TRACE" })).toBe(false);
    expect(isValidWebRequest({ url: `${SITE}/a`, keep: [{ path: "a", as: "bad name" }] })).toBe(false);
  });
});
