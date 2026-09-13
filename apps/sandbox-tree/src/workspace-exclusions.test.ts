import { describe, expect, it } from "vitest";
import { buildWorkspaceExclusionSet } from "./workspace-exclusions.js";

const SOURCE = "/srv/ashley/live-checkout";
const NO_PROTECTED = { delegatedWriteDeniedOwnerApprovable: [], absoluteDenial: [] };

function excludesAt(relPath: string): string | null {
  const set = buildWorkspaceExclusionSet(NO_PROTECTED, SOURCE);
  const verdict = set.excludes(relPath);
  return verdict.excluded ? verdict.code : null;
}

describe("workspace exclusions", () => {
  it("excludes vcs metadata at any depth", () => {
    expect(excludesAt(".git")).toBe("vcs_metadata");
    expect(excludesAt("src/.git")).toBe("vcs_metadata");
    expect(excludesAt("a/b/.git/config")).toBe("vcs_metadata");
    expect(excludesAt(".hg")).toBe("vcs_metadata");
    expect(excludesAt(".svn")).toBe("vcs_metadata");
  });

  it("excludes env files", () => {
    expect(excludesAt(".env")).toBe("env_secrets");
    expect(excludesAt("config/.env.local")).toBe("env_secrets");
    expect(excludesAt(".env.production")).toBe("env_secrets");
    expect(excludesAt(".env.example")).toBe("env_secrets");
  });

  it("excludes key material", () => {
    expect(excludesAt("keys/id_rsa")).toBe("key_material");
    expect(excludesAt("a/b.pem")).toBe("key_material");
    expect(excludesAt("a/b.key")).toBe("key_material");
    expect(excludesAt("a/b.p12")).toBe("key_material");
    expect(excludesAt("a/b.pfx")).toBe("key_material");
    expect(excludesAt("a/b.crt")).toBe("key_material");
    expect(excludesAt(".ssh/known_hosts")).toBe("key_material");
  });

  it("excludes credential-shaped files", () => {
    expect(excludesAt("credentials.json")).toBe("credential_files");
    expect(excludesAt("creds/secret.txt")).toBe("credential_files");
    expect(excludesAt("creds/.secret.yaml")).toBe("credential_files");
    expect(excludesAt("user/credentials")).toBe("credential_files");
  });

  it("excludes dependency, build, coverage, cache and log paths", () => {
    expect(excludesAt("node_modules/pkg/index.js")).toBe("dependency_directories");
    expect(excludesAt("src/dist/main.js")).toBe("build_output");
    expect(excludesAt("build/out")).toBe("build_output");
    expect(excludesAt("coverage/lcov.info")).toBe("coverage_output");
    expect(excludesAt("a/.cache/b")).toBe("cache_directories");
    expect(excludesAt("logs/error.log")).toBe("log_files");
    expect(excludesAt("x.log")).toBe("log_files");
    expect(excludesAt("sessions/s.session")).toBe("session_journals");
    expect(excludesAt("sessions/s.session-journal")).toBe("session_journals");
  });

  it("excludes database files", () => {
    expect(excludesAt("data/app.db")).toBe("database_files");
    expect(excludesAt("data/app.db-wal")).toBe("database_files");
    expect(excludesAt("data/app.db-shm")).toBe("database_files");
    expect(excludesAt("data/app.sqlite")).toBe("database_files");
    expect(excludesAt("data/app.sqlite3")).toBe("database_files");
  });

  it("excludes the reserved broker metadata name", () => {
    expect(excludesAt(".ashley-meta")).toBe("reserved_broker_metadata");
    expect(excludesAt("x/.ashley-meta/y")).toBe("reserved_broker_metadata");
  });

  it("keeps ordinary source files", () => {
    for (const rel of [
      "README.md",
      "src/index.ts",
      ".gitignore",
      ".gitattributes",
      "docs/a.md",
      "apps/agent-service/package.json",
      "workspace/prompts/core-ashley.md",
    ]) {
      expect(excludesAt(rel)).toBeNull();
    }
  });

  it("adds protected roots inside the source root as exact paths", () => {
    const set = buildWorkspaceExclusionSet(
      {
        delegatedWriteDeniedOwnerApprovable: [],
        absoluteDenial: [`${SOURCE}/.env`],
      },
      SOURCE,
    );
    expect(set.protectedPaths).toContain(".env");
    expect(set.excludes(".env").excluded).toBe(true);
    expect(set.excludes(".env.local").excluded).toBe(true);
    expect(set.codes).toContain("protected_root_path");
  });

  it("does not add protected roots outside the source root", () => {
    const set = buildWorkspaceExclusionSet(
      {
        delegatedWriteDeniedOwnerApprovable: [],
        absoluteDenial: ["/home/doc/.composer-assistant/.env", "/srv/other"],
      },
      SOURCE,
    );
    expect(set.protectedPaths).toEqual([]);
    expect(set.codes).not.toContain("protected_root_path");
  });

  it("distinguishes sibling-prefix protected paths", () => {
    const set = buildWorkspaceExclusionSet(
      {
        delegatedWriteDeniedOwnerApprovable: [],
        absoluteDenial: [`${SOURCE}/docs/private`],
      },
      SOURCE,
    );
    expect(set.excludes("docs/private/key.json").excluded).toBe(true);
    expect(set.excludes("docs/private-data/key.json").excluded).toBe(false);
    expect(set.excludes("docs/private-data").excluded).toBe(false);
  });

  it("reports the full mandatory code set", () => {
    const set = buildWorkspaceExclusionSet(NO_PROTECTED, SOURCE);
    for (const code of [
      "vcs_metadata",
      "env_secrets",
      "key_material",
      "credential_files",
      "dependency_directories",
      "build_output",
      "coverage_output",
      "cache_directories",
      "log_files",
      "session_journals",
      "database_files",
      "transient_files",
      "reserved_broker_metadata",
    ]) {
      expect(set.codes).toContain(code);
    }
  });
});
