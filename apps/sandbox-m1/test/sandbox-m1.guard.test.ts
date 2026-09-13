import { describe, expect, it } from "vitest";
import { isCompleteSuccessResult, type SandboxM1Result } from "../src/sandbox-m1.js";

const valid: Extract<SandboxM1Result, { ok: true }> = {
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

describe("isCompleteSuccessResult (fail-closed)", () => {
  it("accepts a complete all-true result", () => {
    expect(isCompleteSuccessResult(valid)).toBe(true);
  });

  it("rejects a missing check key", () => {
    const checks = { ...valid.checks } as Record<string, boolean>;
    delete checks.fdClean;
    expect(isCompleteSuccessResult({ ...valid, checks })).toBe(false);
  });

  it("rejects any false check", () => {
    expect(
      isCompleteSuccessResult({
        ...valid,
        checks: { ...valid.checks, loopbackIsolated: false },
      }),
    ).toBe(false);
  });

  it("rejects ok:false results", () => {
    expect(isCompleteSuccessResult({ version: 1, kind: "file.roundtrip", ok: false, code: "timeout" })).toBe(false);
  });

  it("rejects a wrong version", () => {
    expect(isCompleteSuccessResult({ ...valid, version: 2 })).toBe(false);
  });

  it("rejects a wrong kind", () => {
    expect(isCompleteSuccessResult({ ...valid, kind: "shell.exec" })).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isCompleteSuccessResult(null)).toBe(false);
    expect(isCompleteSuccessResult("ok")).toBe(false);
    expect(isCompleteSuccessResult(undefined)).toBe(false);
  });
});