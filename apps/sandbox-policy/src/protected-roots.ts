/**
 * Protected-root classification for sandbox policy evaluation.
 *
 * `delegated_write_denied_owner_approvable` roots (live checkout, active
 * deployment directory, live `.git` metadata, production configuration,
 * selected persistent application paths) may never be written by a delegated
 * signer; a later fixed owner-approved transition may modify selected roots
 * in this class. `absolute_denial` roots (signing keys, secret-bearing env
 * files, credential stores, the active signed policy and its signature,
 * trusted-key configuration, broker authorization/safeguard configuration,
 * audit-log storage, unrelated personal files, system-security data) are
 * denied for every intent and every signer — an owner signature cannot
 * override an absolute denial.
 */

import { isWithin } from "./canonical-paths.js";
import type { ProtectedRootClass, SandboxPathIntent } from "./types.js";

export type ProtectedRootsConfig = {
  delegatedWriteDeniedOwnerApprovable: readonly string[];
  absoluteDenial: readonly string[];
};

export type ProtectedPathClass =
  | { class: "none" }
  | { class: ProtectedRootClass; root: string };

/**
 * Classifies a canonical path against the configured protected roots.
 * `absolute_denial` wins when a path sits under both classes; within a
 * class the most specific matching root wins.
 */
export function classifyProtectedPath(
  config: ProtectedRootsConfig,
  path: string,
): ProtectedPathClass {
  let bestAbsolute: ProtectedPathClass = { class: "none" };
  let bestAbsoluteLen = -1;
  for (const root of config.absoluteDenial) {
    if (isWithin(root, path) && root.length > bestAbsoluteLen) {
      bestAbsolute = { class: "absolute_denial", root };
      bestAbsoluteLen = root.length;
    }
  }
  if (bestAbsolute.class !== "none") return bestAbsolute;

  let bestDelegated: ProtectedPathClass = { class: "none" };
  let bestDelegatedLen = -1;
  for (const root of config.delegatedWriteDeniedOwnerApprovable) {
    if (isWithin(root, path) && root.length > bestDelegatedLen) {
      bestDelegated = { class: "delegated_write_denied_owner_approvable", root };
      bestDelegatedLen = root.length;
    }
  }
  return bestDelegated;
}

export type ProtectedConflict =
  | { conflict: false }
  | { conflict: true; rootClass: ProtectedRootClass; root: string };

/**
 * Intent-aware protected-root conflict for a canonical path.
 * Reads of an `absolute_denial` root are secret exposure and always conflict.
 * Writes or deletes under either class conflict with delegated execution.
 */
export function protectedConflictForIntent(
  config: ProtectedRootsConfig,
  path: string,
  intent: SandboxPathIntent,
): ProtectedConflict {
  const classified = classifyProtectedPath(config, path);
  if (classified.class === "absolute_denial") {
    return { conflict: true, rootClass: "absolute_denial", root: classified.root };
  }
  if (
    classified.class === "delegated_write_denied_owner_approvable" &&
    intent !== "read"
  ) {
    return {
      conflict: true,
      rootClass: "delegated_write_denied_owner_approvable",
      root: classified.root,
    };
  }
  return { conflict: false };
}

export function toProtectedRootsConfig(
  protectedRoots: readonly {
    path: string;
    class: ProtectedRootClass;
  }[],
): ProtectedRootsConfig {
  return {
    delegatedWriteDeniedOwnerApprovable: protectedRoots
      .filter((entry) => entry.class === "delegated_write_denied_owner_approvable")
      .map((entry) => entry.path),
    absoluteDenial: protectedRoots
      .filter((entry) => entry.class === "absolute_denial")
      .map((entry) => entry.path),
  };
}
