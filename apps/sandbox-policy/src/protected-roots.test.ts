import { describe, expect, it } from "vitest";
import {
  classifyProtectedPath,
  protectedConflictForIntent,
  toProtectedRootsConfig,
} from "./protected-roots.js";

const CONFIG = toProtectedRootsConfig([
  {
    path: "/srv/ashley/live-checkout",
    class: "delegated_write_denied_owner_approvable",
  },
  {
    path: "/srv/ashley/live-checkout/.git",
    class: "delegated_write_denied_owner_approvable",
  },
  {
    path: "/home/doc/.composer-assistant/.env",
    class: "absolute_denial",
  },
  {
    path: "/var/lib/ashley-sandbox/meta/keys",
    class: "absolute_denial",
  },
]);

describe("toProtectedRootsConfig", () => {
  it("splits roots into the two classes", () => {
    expect(CONFIG.delegatedWriteDeniedOwnerApprovable).toEqual([
      "/srv/ashley/live-checkout",
      "/srv/ashley/live-checkout/.git",
    ]);
    expect(CONFIG.absoluteDenial).toEqual([
      "/home/doc/.composer-assistant/.env",
      "/var/lib/ashley-sandbox/meta/keys",
    ]);
  });

  it("handles an empty root list", () => {
    const empty = toProtectedRootsConfig([]);
    expect(empty.delegatedWriteDeniedOwnerApprovable).toEqual([]);
    expect(empty.absoluteDenial).toEqual([]);
  });
});

describe("classifyProtectedPath", () => {
  it("classifies a nested file under the live checkout", () => {
    const result = classifyProtectedPath(
      CONFIG,
      "/srv/ashley/live-checkout/src/core/db.ts",
    );
    expect(result).toEqual({
      class: "delegated_write_denied_owner_approvable",
      root: "/srv/ashley/live-checkout",
    });
  });

  it("classifies a file under a more specific root (.git)", () => {
    const result = classifyProtectedPath(
      CONFIG,
      "/srv/ashley/live-checkout/.git/objects/pack/x.pack",
    );
    expect(result.class).toBe("delegated_write_denied_owner_approvable");
    if (result.class !== "none") {
      expect(result.root).toBe("/srv/ashley/live-checkout/.git");
    }
  });

  it("classifies an absolute-denial path", () => {
    const result = classifyProtectedPath(
      CONFIG,
      "/home/doc/.composer-assistant/.env",
    );
    expect(result).toEqual({
      class: "absolute_denial",
      root: "/home/doc/.composer-assistant/.env",
    });
  });

  it("absolute_denial wins over an overlapping delegated-denied root", () => {
    const config = toProtectedRootsConfig([
      { path: "/srv/ashley/live-checkout", class: "delegated_write_denied_owner_approvable" },
      { path: "/srv/ashley/live-checkout/.secrets", class: "absolute_denial" },
    ]);
    const result = classifyProtectedPath(
      config,
      "/srv/ashley/live-checkout/.secrets/token",
    );
    expect(result.class).toBe("absolute_denial");
  });

  it("returns none for an unrelated path", () => {
    const result = classifyProtectedPath(
      CONFIG,
      "/var/lib/ashley-sandbox/work/candidate/notes.md",
    );
    expect(result).toEqual({ class: "none" });
  });

  it("never classifies by unsafe prefix (sibling directory)", () => {
    const result = classifyProtectedPath(
      CONFIG,
      "/srv/ashley-live-checkout-other/file",
    );
    expect(result).toEqual({ class: "none" });
  });
});

describe("protectedConflictForIntent", () => {
  it("conflicts on any intent under an absolute-denial root", () => {
    for (const intent of ["read", "write", "delete"] as const) {
      const result = protectedConflictForIntent(
        CONFIG,
        "/var/lib/ashley-sandbox/meta/keys/owner-ed25519-v1.pub",
        intent,
      );
      expect(result.conflict).toBe(true);
      if (result.conflict) {
        expect(result.rootClass).toBe("absolute_denial");
      }
    }
  });

  it("does not conflict on read of the live checkout", () => {
    const result = protectedConflictForIntent(
      CONFIG,
      "/srv/ashley/live-checkout/src/core/db.ts",
      "read",
    );
    expect(result).toEqual({ conflict: false });
  });

  it("conflicts on write or delete of the live checkout", () => {
    for (const intent of ["write", "delete"] as const) {
      const result = protectedConflictForIntent(
        CONFIG,
        "/srv/ashley/live-checkout/src/core/db.ts",
        intent,
      );
      expect(result.conflict).toBe(true);
      if (result.conflict) {
        expect(result.rootClass).toBe("delegated_write_denied_owner_approvable");
      }
    }
  });

  it("does not conflict on a disposable-workspace write", () => {
    const result = protectedConflictForIntent(
      CONFIG,
      "/var/lib/ashley-sandbox/work/candidate/notes.md",
      "write",
    );
    expect(result).toEqual({ conflict: false });
  });
});
