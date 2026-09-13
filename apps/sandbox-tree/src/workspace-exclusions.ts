/**
 * Disposable workspace exclusions (Sandbox Wave 4, Commit 7).
 *
 * A candidate copy is sanitized by excluding, at every depth, entries that
 * are security-relevant by shape: VCS metadata, secret-shaped files (env
 * files, key material, credential files), dependency and build output
 * directories, logs, database files, caches, session journals, and the
 * broker's own reserved metadata name. `.gitignore` files are never parsed:
 * they are source-controlled, may be crafted, and are not an authorization
 * mechanism. Mandatory shape rules apply unconditionally; additionally,
 * any configured protected root that sits inside the source root is
 * excluded by exact relative path.
 */

import type { ProtectedRootsConfig } from "@composer-assistant/sandbox-policy";
import { isWithin } from "@composer-assistant/sandbox-policy";

export type WorkspaceExclusionRule = {
  code: string;
  kind: "literal" | "prefix" | "suffix";
  name: string;
};

/** Broker-reserved directory name inside disposable roots. Never copied. */
export const RESERVED_BROKER_METADATA_NAME = ".ashley-meta";

export const MANDATORY_EXCLUSION_RULES: readonly WorkspaceExclusionRule[] = [
  // VCS metadata
  { code: "vcs_metadata", kind: "literal", name: ".git" },
  { code: "vcs_metadata", kind: "literal", name: ".hg" },
  { code: "vcs_metadata", kind: "literal", name: ".svn" },
  { code: "vcs_metadata", kind: "literal", name: ".bzr" },
  // Secret-shaped env files
  { code: "env_secrets", kind: "literal", name: ".env" },
  { code: "env_secrets", kind: "prefix", name: ".env." },
  // Key material
  { code: "key_material", kind: "suffix", name: ".pem" },
  { code: "key_material", kind: "suffix", name: ".key" },
  { code: "key_material", kind: "suffix", name: ".p12" },
  { code: "key_material", kind: "suffix", name: ".pfx" },
  { code: "key_material", kind: "suffix", name: ".crt" },
  { code: "key_material", kind: "suffix", name: ".cer" },
  { code: "key_material", kind: "suffix", name: ".der" },
  { code: "key_material", kind: "literal", name: "id_rsa" },
  { code: "key_material", kind: "literal", name: "id_ed25519" },
  { code: "key_material", kind: "literal", name: "id_ecdsa" },
  { code: "key_material", kind: "literal", name: "id_dsa" },
  { code: "key_material", kind: "literal", name: ".ssh" },
  // Credential-shaped files
  { code: "credential_files", kind: "literal", name: "credentials" },
  { code: "credential_files", kind: "literal", name: "credentials.json" },
  { code: "credential_files", kind: "literal", name: ".credentials" },
  { code: "credential_files", kind: "literal", name: ".credentials.json" },
  { code: "credential_files", kind: "prefix", name: "secret" },
  { code: "credential_files", kind: "prefix", name: ".secret" },
  // Dependency and build output
  { code: "dependency_directories", kind: "literal", name: "node_modules" },
  { code: "dependency_directories", kind: "literal", name: ".venv" },
  { code: "dependency_directories", kind: "literal", name: "venv" },
  { code: "dependency_directories", kind: "literal", name: "__pycache__" },
  { code: "dependency_directories", kind: "literal", name: ".pytest_cache" },
  { code: "build_output", kind: "literal", name: "dist" },
  { code: "build_output", kind: "literal", name: "build" },
  { code: "build_output", kind: "literal", name: ".turbo" },
  { code: "build_output", kind: "literal", name: ".next" },
  { code: "build_output", kind: "literal", name: ".nuxt" },
  { code: "build_output", kind: "literal", name: ".svelte-kit" },
  // Coverage and caches
  { code: "coverage_output", kind: "literal", name: "coverage" },
  { code: "coverage_output", kind: "literal", name: ".coverage" },
  { code: "cache_directories", kind: "literal", name: ".cache" },
  { code: "cache_directories", kind: "literal", name: "cache" },
  // Logs and session journals
  { code: "log_files", kind: "literal", name: "logs" },
  { code: "log_files", kind: "literal", name: "log" },
  { code: "log_files", kind: "suffix", name: ".log" },
  { code: "session_journals", kind: "suffix", name: ".session" },
  { code: "session_journals", kind: "suffix", name: ".session-journal" },
  // Databases
  { code: "database_files", kind: "suffix", name: ".db" },
  { code: "database_files", kind: "suffix", name: ".db-wal" },
  { code: "database_files", kind: "suffix", name: ".db-shm" },
  { code: "database_files", kind: "suffix", name: ".sqlite" },
  { code: "database_files", kind: "suffix", name: ".sqlite3" },
  // Transient and editor files
  { code: "transient_files", kind: "literal", name: "tmp" },
  { code: "transient_files", kind: "literal", name: ".tmp" },
  { code: "transient_files", kind: "suffix", name: ".tmp" },
  { code: "transient_files", kind: "suffix", name: ".temp" },
  { code: "transient_files", kind: "suffix", name: ".swp" },
  { code: "transient_files", kind: "suffix", name: ".swo" },
  { code: "transient_files", kind: "suffix", name: ".part" },
  { code: "transient_files", kind: "literal", name: ".DS_Store" },
  { code: "transient_files", kind: "literal", name: ".idea" },
  { code: "transient_files", kind: "literal", name: ".vscode" },
  // Broker-reserved metadata (never part of a candidate tree)
  { code: "reserved_broker_metadata", kind: "literal", name: RESERVED_BROKER_METADATA_NAME },
];

export type WorkspaceExclusionSet = {
  /** Static rule set the set was built from. */
  rules: readonly WorkspaceExclusionRule[];
  /** Exact protected relative paths (POSIX) excluded inside the source root. */
  protectedPaths: readonly string[];
  /** Distinct exclusion codes applicable to this source root. */
  codes: readonly string[];
  /**
   * Evaluates a POSIX relative path below the source root. Fails closed:
   * any matching segment excludes the whole subtree.
   */
  excludes: (
    relPath: string,
  ) => { excluded: true; code: string } | { excluded: false };
};

function protectedPathRelative(sourceRoot: string, root: string): string | null {
  if (root === sourceRoot) return null;
  if (!isWithin(sourceRoot, root)) return null;
  const rel = root.slice(sourceRoot.length).replace(/^\/+/, "");
  if (rel.length === 0 || rel.includes("..")) return null;
  return rel;
}

/**
 * Builds the exclusion set for a source root. Mandatory shape rules always
 * apply; protected roots strictly inside the source root are added as exact
 * relative paths. Protected roots at or above the source root are handled by
 * source eligibility (a protected source root is rejected before copying).
 */
export function buildWorkspaceExclusionSet(
  protectedRoots: ProtectedRootsConfig,
  sourceRoot: string,
): WorkspaceExclusionSet {
  const protectedPaths: string[] = [];
  for (const root of [
    ...protectedRoots.delegatedWriteDeniedOwnerApprovable,
    ...protectedRoots.absoluteDenial,
  ]) {
    const rel = protectedPathRelative(sourceRoot, root);
    if (rel !== null && !protectedPaths.includes(rel)) protectedPaths.push(rel);
  }
  const codes = Array.from(
    new Set([
      ...MANDATORY_EXCLUSION_RULES.map((rule) => rule.code),
      ...(protectedPaths.length > 0 ? ["protected_root_path"] : []),
    ]),
  );
  return {
    rules: MANDATORY_EXCLUSION_RULES,
    protectedPaths,
    codes,
    excludes(relPath) {
      const segments = relPath.split("/").filter((segment) => segment.length > 0);
      for (const segment of segments) {
        for (const rule of MANDATORY_EXCLUSION_RULES) {
          const hit =
            rule.kind === "literal"
              ? segment === rule.name
              : rule.kind === "prefix"
                ? segment.startsWith(rule.name)
                : segment.endsWith(rule.name);
          if (hit) return { excluded: true, code: rule.code };
        }
      }
      for (const rel of protectedPaths) {
        if (relPath === rel || relPath.startsWith(`${rel}/`)) {
          return { excluded: true, code: "protected_root_path" };
        }
      }
      return { excluded: false };
    },
  };
}
