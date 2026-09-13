import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V2ProjectReadRegistry, type ProjectReadResolution } from "./registry.js";
import type { ProjectRootEntry } from "@composer-assistant/sandbox-policy";

function entry(overrides: Partial<ProjectRootEntry> = {}): ProjectRootEntry {
  return {
    projectId: "composer-assistant",
    canonicalRoot: "/srv/projects/composer-assistant",
    displayName: "Composer Assistant",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: false,
    engineeringAllowed: false,
    ...overrides,
  };
}

const ROOTS = {
  enabled: "/srv/projects/enabled",
  disabled: "/srv/projects/disabled",
  denied: "/srv/projects/denied",
  dup: "/srv/projects/dup-a",
  dup2: "/srv/projects/dup-b",
  fileProject: "/srv/projects/file-project",
};

describe("V2ProjectReadRegistry", () => {
  it("resolves an explicitly read-authorized project", () => {
    const registry = new V2ProjectReadRegistry([entry()]);
    const resolution: ProjectReadResolution = registry.resolveReadRoot("composer-assistant");
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.entry.projectId).toBe("composer-assistant");
  });

  it("fails closed for unknown, disabled, and read-denied projects", () => {
    const registry = new V2ProjectReadRegistry([
      entry({ projectId: "enabled", canonicalRoot: ROOTS.enabled }),
      entry({ projectId: "disabled", canonicalRoot: ROOTS.disabled, enabled: false }),
      entry({ projectId: "denied", canonicalRoot: ROOTS.denied, readAllowed: false }),
    ]);
    expect(registry.resolveReadRoot("unknown").ok).toBe(false);
    const disabled = registry.resolveReadRoot("disabled");
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.error).toBe("project_disabled");
    const denied = registry.resolveReadRoot("denied");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe("read_not_allowed");
  });

  it("rejects invalid project ids and oversized ids", () => {
    const registry = new V2ProjectReadRegistry([entry()]);
    expect(registry.resolveReadRoot("").ok).toBe(false);
    expect(registry.resolveReadRoot("x".repeat(129)).ok).toBe(false);
  });

  it("rejects a duplicate projectId at construction", () => {
    expect(() =>
      new V2ProjectReadRegistry([
        entry({ projectId: "dup", canonicalRoot: ROOTS.dup }),
        entry({ projectId: "dup", canonicalRoot: ROOTS.dup2 }),
      ]),
    ).toThrow(/v2_project_registry_invalid/);
  });

  it("loads an operator-provided registry file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-v2-reg-"));
    try {
      const file = join(dir, "registry.json");
      writeFileSync(
        file,
        JSON.stringify([
          entry({ projectId: "file-project", canonicalRoot: ROOTS.fileProject }),
        ]),
        "utf8",
      );
      const registry = V2ProjectReadRegistry.loadFromFile(file);
      expect(registry.list().map((e) => e.projectId)).toEqual(["file-project"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});