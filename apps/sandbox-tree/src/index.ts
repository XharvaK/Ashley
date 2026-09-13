/**
 * Shared sanitized-tree primitives (Sandbox V2 M2 extraction).
 *
 * Neutral, pure, host-filesystem utilities for building sanitized bounded
 * source/tree views: mandatory shape exclusions plus protected-root paths,
 * and the deterministic lstat-first copy that never follows symlinks.
 *
 * This package is deliberately dependency-light: it depends only on
 * `@composer-assistant/sandbox-policy` (pure path/exclusion policy). It is
 * used by the Sandbox V2 capability kernel (sanitized read-only project source
 * views).
 */

export * from "./workspace-exclusions.js";
export * from "./workspace-copy.js";
