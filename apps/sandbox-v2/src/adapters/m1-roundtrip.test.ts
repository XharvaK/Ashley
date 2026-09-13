import { describe, expect, it } from "vitest";
import { handleFileRoundtripV2 } from "./m1-roundtrip.js";
import { V2_SECRET_ENV_KEY } from "../limits.js";
import type { SandboxM1HostEvidence, SandboxM1Request, SandboxM1Result } from "@composer-assistant/sandbox-m1";

const complete: Extract<SandboxM1Result, { ok: true }> = {
  version: 1,
  kind: "file.roundtrip",
  ok: true,
  checks: {
    roundtrip: true,
    deleted: true,
    absent: true,
    homeAbsent: true,
    runAbsent: true,
    hostSentinelAbsent: true,
    envClean: true,
    loopbackIsolated: true,
    externalIsolated: true,
    fdClean: true,
  },
};

function fakeExecutor(script: (request: SandboxM1Request, hostEvidence: SandboxM1HostEvidence) => SandboxM1Result) {
  return async (request: SandboxM1Request, hostEvidence: SandboxM1HostEvidence) => script(request, hostEvidence);
}

describe("handleFileRoundtripV2", () => {
  it("uses the selected child deadline and refuses a result outside settlement", async () => {
    let nowMs = 1_000;
    let timeoutMs = -1;
    const result = await handleFileRoundtripV2(
      { version: 2, operation: "file.roundtrip", content: "hello" },
      {
        childExecutionDeadlineAtMs: 1_300,
        settlementDeadlineAtMs: 1_500,
        clock: { nowMs: () => nowMs },
        executor: async (_request, _evidence, options) => {
          timeoutMs = options?.timeoutMs ?? -1;
          nowMs = 1_510;
          return complete;
        },
      },
    );

    expect(timeoutMs).toBe(300);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "settlement_deadline_exceeded",
    });
  });

  it("maps a complete M1 success into the V2 typed result with host evidence", async () => {
    let seenEvidence: SandboxM1HostEvidence | undefined;
    let seenRequest: SandboxM1Request | undefined;
    const result = await handleFileRoundtripV2(
      { version: 2, operation: "file.roundtrip", content: "hello" },
      {
        executor: fakeExecutor((request, hostEvidence) => {
          seenRequest = request;
          seenEvidence = hostEvidence;
          return complete;
        }),
      },
    );
    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded" && result.result.kind === "file.roundtrip") {
      expect(result.result.bytesWritten).toBe(5);
      expect(result.result.contentHash).toBe(
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      );
      expect(result.result.readMatches).toBe(true);
      expect(result.result.deleted).toBe(true);
      expect(result.result.verifiedAbsent).toBe(true);
      expect(result.result.checks.loopbackIsolated).toBe(true);
    }
    expect(seenRequest?.version).toBe(1);
    expect(seenRequest?.kind).toBe("file.roundtrip");
    expect(seenRequest?.content).toBe("hello");
    expect(seenRequest?.probePort).toBeGreaterThan(0);
    expect(seenRequest?.sentinelPath.length).toBeGreaterThan(0);
    expect(seenEvidence?.loopbackPositiveControlSucceeded).toBe(true);
  });

  it("fails closed when the M1 result is not a complete success", async () => {
    for (const script of [
      () => ({ version: 1, kind: "file.roundtrip", ok: false, code: "timeout" } as SandboxM1Result),
      () =>
        ({
          version: 1,
          kind: "file.roundtrip",
          ok: true,
          checks: { ...complete.checks, fdClean: false },
        } as SandboxM1Result),
    ]) {
      const result = await handleFileRoundtripV2(
        { version: 2, operation: "file.roundtrip", content: "hello" },
        { executor: fakeExecutor(script) },
      );
      expect(result.outcome).toBe("failed");
      if (result.outcome === "failed") expect(result.error).not.toBe("");
    }
  });

  it("returns unavailable when the substrate is missing (no custom executor)", async () => {
    const result = await handleFileRoundtripV2(
      { version: 2, operation: "file.roundtrip", content: "hello" },
      { available: () => false },
    );
    expect(result.outcome).toBe("unavailable");
  });

  it("defaults content to hello like the production adapter", async () => {
    let content: string | undefined;
    await handleFileRoundtripV2(
      { version: 2, operation: "file.roundtrip" },
      {
        executor: fakeExecutor((request) => {
          content = request.content;
          return complete;
        }),
      },
    );
    expect(content).toBe("hello");
  });

  it("restores the secret env after execution", async () => {
    process.env[V2_SECRET_ENV_KEY] = "previous";
    const result = await handleFileRoundtripV2(
      { version: 2, operation: "file.roundtrip", content: "hello" },
      { executor: fakeExecutor(() => complete) },
    );
    expect(result.outcome).toBe("succeeded");
    expect(process.env[V2_SECRET_ENV_KEY]).toBe("previous");
    delete process.env[V2_SECRET_ENV_KEY];
  });
});
