/**
 * Shared deterministic sandbox-policy foundation (Sandbox Wave 4, Commit 1).
 *
 * A dependency-light, pure, deterministic policy-decision module usable by
 * both agent-service (current projection) and sandbox-v2 (final execution).
 * It never executes commands, never
 * touches the filesystem, never reads secrets, and never consults
 * identity-governance or model/provider state.
 */

export * from "./types.js";
export * from "./canonical-paths.js";
export * from "./canonical-payload.js";
export * from "./protected-roots.js";
export * from "./classify.js";
export * from "./policy-schema.js";
export * from "./authorize.js";
export * from "./engineering.js";
export * from "./project-roots.js";
