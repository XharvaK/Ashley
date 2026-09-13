import { describe, expect, it } from "vitest";
import {
  canonicalizePath,
  canonicalizeWithinRoot,
  isCanonicalForm,
  isWithin,
  isWithinAny,
} from "./canonical-paths.js";

describe("canonicalizePath", () => {
  it("produces deterministic canonical absolute forms", () => {
    expect(canonicalizePath("/var/lib/ashley-sandbox/work")).toEqual({
      ok: true,
      value: "/var/lib/ashley-sandbox/work",
    });
    expect(canonicalizePath("//var//lib///work/")).toEqual({
      ok: true,
      value: "/var/lib/work",
    });
    expect(canonicalizePath("/a/./b/../c")).toEqual({ ok: true, value: "/a/c" });
  });

  it("normalizes backslash separators to POSIX form", () => {
    expect(canonicalizePath("C:\\Users\\doc\\ashley")).toEqual({
      ok: false,
      reason: "path_not_absolute",
    });
    expect(canonicalizePath("/var\\lib\\work")).toEqual({
      ok: true,
      value: "/var/lib/work",
    });
  });

  it("rejects empty, relative and NUL-containing inputs", () => {
    expect(canonicalizePath("")).toEqual({ ok: false, reason: "path_empty" });
    expect(canonicalizePath("relative/path")).toEqual({
      ok: false,
      reason: "path_not_absolute",
    });
    expect(canonicalizePath("/a\0b")).toEqual({
      ok: false,
      reason: "path_invalid_nul",
    });
  });

  it("rejects traversal above the filesystem root", () => {
    expect(canonicalizePath("/a/b/../../..")).toEqual({
      ok: false,
      reason: "path_escape_above_root",
    });
  });
});

describe("canonicalizeWithinRoot", () => {
  it("resolves relative candidates inside the root", () => {
    const result = canonicalizeWithinRoot(
      "/var/lib/ashley-sandbox/work",
      "candidate/src/a.ts",
    );
    expect(result).toEqual({
      ok: true,
      value: "/var/lib/ashley-sandbox/work/candidate/src/a.ts",
    });
  });

  it("rejects traversal that escapes the root", () => {
    expect(
      canonicalizeWithinRoot("/var/lib/ashley-sandbox/work", "../outside.txt"),
    ).toEqual({ ok: false, reason: "path_not_within_root" });
    expect(
      canonicalizeWithinRoot("/var/lib/ashley-sandbox/work", "a/../../outside"),
    ).toEqual({ ok: false, reason: "path_not_within_root" });
  });

  it("rejects absolute candidates outside the root", () => {
    expect(
      canonicalizeWithinRoot("/var/lib/ashley-sandbox/work", "/home/doc/secret"),
    ).toEqual({ ok: false, reason: "path_not_within_root" });
  });

  it("accepts absolute candidates inside the root", () => {
    const result = canonicalizeWithinRoot(
      "/var/lib/ashley-sandbox/work",
      "/var/lib/ashley-sandbox/work/candidate",
    );
    expect(result).toEqual({
      ok: true,
      value: "/var/lib/ashley-sandbox/work/candidate",
    });
  });
});

describe("isCanonicalForm", () => {
  it("accepts canonical paths and rejects raw traversal forms", () => {
    expect(isCanonicalForm("/a/b/c")).toBe(true);
    expect(isCanonicalForm("/")).toBe(true);
    expect(isCanonicalForm("/a/b/../c")).toBe(false);
    expect(isCanonicalForm("/a//b")).toBe(false);
    expect(isCanonicalForm("/a/b/")).toBe(false);
    expect(isCanonicalForm("a/b")).toBe(false);
  });
});

describe("isWithin", () => {
  it("uses segmented containment, never unsafe prefix matching", () => {
    expect(isWithin("/var/lib/ashley-sandbox", "/var/lib/ashley-sandbox/work/x")).toBe(true);
    expect(isWithin("/var/lib/ashley-sandbox", "/var/lib/ashley-sandbox-work/x")).toBe(false);
    expect(isWithin("/a/ashley", "/a/ashleyx/file")).toBe(false);
    expect(isWithin("/a/bc", "/a/b/file")).toBe(false);
  });

  it("handles root equality explicitly", () => {
    expect(isWithin("/var/lib/ashley-sandbox/work", "/var/lib/ashley-sandbox/work")).toBe(true);
    expect(isWithin("/var/lib/ashley-sandbox/work", "/var/lib/ashley-sandbox")).toBe(false);
    expect(isWithin("/", "/anything")).toBe(true);
    expect(isWithin("/anything", "/")).toBe(false);
  });

  it("fails closed on non-canonical inputs", () => {
    expect(isWithin("/var/lib/../work", "/var/lib/work")).toBe(false);
    expect(isWithin("/var/lib/work", "/var/lib/../work")).toBe(false);
  });
});

describe("isWithinAny", () => {
  it("matches any listed root", () => {
    expect(
      isWithinAny(
        ["/srv/ashley/live-checkout", "/var/lib/ashley-sandbox/work"],
        "/var/lib/ashley-sandbox/work/candidate",
      ),
    ).toBe(true);
    expect(
      isWithinAny(
        ["/srv/ashley/live-checkout", "/var/lib/ashley-sandbox/work"],
        "/home/doc/other",
      ),
    ).toBe(false);
  });
});
