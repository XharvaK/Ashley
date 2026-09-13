/**
 * Agent-side durable project-root registry (Autonomous Engineering
 * Workstation wave).
 *
 * The allowlist is host/operator configuration. Ashley may READ it to decide
 * where she may engineer, but she can NEVER create or widen a project root.
 * This module validates the registry (delegating canonical/shape checks to the
 * shared policy module) and exposes read-only lookups.
 */

import {
  validateProjectRootRegistry,
  type ProjectRootEntry,
  type ProjectRootRegistry,
} from "@composer-assistant/sandbox-policy";
import {
  V2ProjectReadRegistry,
  type ProjectReadResolution,
} from "@composer-assistant/sandbox-v2";
import { existsSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import type { CognitionMode } from "../types.js";
import { capabilityCanInfluence } from "../rollout/capabilities.js";
import { isSandboxV2Available } from "./v2-execution.js";

export { V2ProjectReadRegistry, type ProjectReadResolution };

/**
 * Loads the operator-configured V2 project read registry.
 * Strictly fail-closed: if the configured path does not exist or cannot be read,
 * returns an empty registry with zero project authorities.
 * Never derives project authority from cwd, __dirname, or repository discovery.
 */
export function loadOperatorProjectReadRegistry(
  customPath?: string,
): V2ProjectReadRegistry {
  const registryPath = customPath ?? env.sandboxProjectRegistryPath;
  if (!registryPath || !existsSync(registryPath)) {
    return new V2ProjectReadRegistry([]);
  }
  try {
    return V2ProjectReadRegistry.loadFromFile(registryPath);
  } catch {
    return new V2ProjectReadRegistry([]);
  }
}

/**
 * Returns safe, operator-approved project IDs for cognition self-model and prompts.
 * Exposes ONLY stable string identifiers (e.g. "project-ashley"), never host filesystem roots.
 */
export function listApprovedReadProjectIds(
  registry: V2ProjectReadRegistry = loadOperatorProjectReadRegistry(),
): string[] {
  return registry
    .list()
    .filter((entry) => entry.enabled && entry.readAllowed)
    .map((entry) => entry.projectId);
}

export type CanOfferProjectInspectionOptions = {
  registry?: V2ProjectReadRegistry;
  masterMode?: CognitionMode;
  substrateAvailable?: boolean;
  lifecycleEnabled?: boolean;
};

/**
 * Checks all four conditions for offering M2 project inspection to Thought:
 * 1. project_inspection release state permits live influence;
 * 2. sandbox lifecycle permits execution;
 * 3. Sandbox V2 substrate is available;
 * 4. at least one approved read projectId exists.
 */
export function canOfferProjectInspection(
  db?: DatabaseSync,
  options?: CanOfferProjectInspectionOptions,
): boolean {
  if (db) {
    try {
      if (!capabilityCanInfluence(db, "project_inspection", options?.masterMode)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  const lifecycle =
    options?.lifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled;
  if (!lifecycle) return false;

  const substrate =
    options?.substrateAvailable ?? isSandboxV2Available();
  if (!substrate) return false;

  const approved = listApprovedReadProjectIds(options?.registry);
  return approved.length > 0;
}

/**
 * Checks all four conditions for offering M3 candidate workspace experiment:
 * 1. project_experimentation release state permits live influence;
 * 2. sandbox lifecycle permits execution;
 * 3. Sandbox V2 substrate is available;
 * 4. at least one approved projectId exists with candidateWorkspaceAllowed.
 */
export function canOfferCandidateWorkspace(
  db?: DatabaseSync,
  options?: CanOfferProjectInspectionOptions,
): boolean {
  if (db) {
    try {
      if (!capabilityCanInfluence(db, "project_experimentation", options?.masterMode)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  const lifecycle =
    options?.lifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled;
  if (!lifecycle) return false;

  const substrate =
    options?.substrateAvailable ?? isSandboxV2Available();
  if (!substrate) return false;

  const registry = options?.registry ?? loadOperatorProjectReadRegistry();
  const approved = listApprovedReadProjectIds(registry);
  if (approved.length === 0) return false;
  return approved.some((pid) => {
    const resolution = registry.resolveReadRoot(pid);
    if (!resolution?.ok) return false;
    return resolution.entry.candidateWorkspaceAllowed;
  });
}

/**
 * Checks conditions for offering M4 candidate verification:
 * 1. candidate_verification release state permits live influence;
 * 2. sandbox lifecycle permits execution;
 * 3. Sandbox V2 substrate is available;
 * 4. at least one approved project has verificationAllowed and a non-empty recipe allowlist.
 *
 * engineeringAllowed and candidateWorkspaceAllowed never grant M4.
 * Substrate availability is not permission.
 */
export function canOfferCandidateVerification(
  db?: DatabaseSync,
  options?: CanOfferProjectInspectionOptions,
): boolean {
  if (db) {
    try {
      if (!capabilityCanInfluence(db, "candidate_verification", options?.masterMode)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  const lifecycle =
    options?.lifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled;
  if (!lifecycle) return false;

  const substrate =
    options?.substrateAvailable ?? isSandboxV2Available();
  if (!substrate) return false;

  const registry = options?.registry ?? loadOperatorProjectReadRegistry();
  const approved = listApprovedReadProjectIds(registry);
  if (approved.length === 0) return false;
  return approved.some((pid) => {
    const resolution = registry.resolveReadRoot(pid);
    if (!resolution?.ok) return false;
    const entry = resolution.entry;
    if (entry.verificationAllowed !== true) return false;
    return (entry.allowedRecipeIds?.length ?? 0) > 0;
  });
}

/**
 * Checks conditions for offering M5 candidate authorship:
 * 1. candidate_authorship release state permits live influence;
 * 2. sandbox lifecycle permits execution;
 * 3. Sandbox V2 substrate is available;
 * 4. at least one approved project has authorshipAllowed.
 *
 * engineeringAllowed, candidateWorkspaceAllowed, and verificationAllowed
 * never grant M5. Substrate availability is not permission.
 */
export function canOfferCandidateAuthorship(
  db?: DatabaseSync,
  options?: CanOfferProjectInspectionOptions,
): boolean {
  if (db) {
    try {
      if (!capabilityCanInfluence(db, "candidate_authorship", options?.masterMode)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  const lifecycle =
    options?.lifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled;
  if (!lifecycle) return false;

  const substrate =
    options?.substrateAvailable ?? isSandboxV2Available();
  if (!substrate) return false;

  const registry = options?.registry ?? loadOperatorProjectReadRegistry();
  const approved = listApprovedReadProjectIds(registry);
  if (approved.length === 0) return false;
  return approved.some((pid) => {
    const resolution = registry.resolveReadRoot(pid);
    if (!resolution?.ok) return false;
    return resolution.entry.authorshipAllowed === true;
  });
}

/**
 * Checks conditions for offering M6 bounded operation:
 * 1. bounded_operation release state permits live influence;
 * 2. sandbox lifecycle permits execution;
 * 3. Sandbox V2 substrate is available;
 * 4. at least one approved project has operationAllowed.
 *
 * authorshipAllowed, verificationAllowed, candidateWorkspaceAllowed, and
 * engineeringAllowed never grant M6.
 */
export function canOfferBoundedOperation(
  db?: DatabaseSync,
  options?: CanOfferProjectInspectionOptions,
): boolean {
  if (db) {
    try {
      if (!capabilityCanInfluence(db, "bounded_operation", options?.masterMode)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  const lifecycle =
    options?.lifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled;
  if (!lifecycle) return false;

  const substrate =
    options?.substrateAvailable ?? isSandboxV2Available();
  if (!substrate) return false;

  const registry = options?.registry ?? loadOperatorProjectReadRegistry();
  const approved = listApprovedReadProjectIds(registry);
  if (approved.length === 0) return false;
  return approved.some((pid) => {
    const resolution = registry.resolveReadRoot(pid);
    if (!resolution?.ok) return false;
    return resolution.entry.operationAllowed === true;
  });
}

/**
 * Checks conditions for offering M7 patch_export:
 * 1. patch_export release state permits live influence;
 * 2. sandbox lifecycle permits execution;
 * 3. Sandbox V2 substrate is available;
 * 4. at least one approved project has patchExportAllowed and a destination root.
 *
 * authorshipAllowed, operationAllowed, verificationAllowed, and
 * engineeringAllowed never grant M7.
 */
export function canOfferPatchExport(
  db?: DatabaseSync,
  options?: CanOfferProjectInspectionOptions,
): boolean {
  if (db) {
    try {
      if (!capabilityCanInfluence(db, "patch_export", options?.masterMode)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  const lifecycle =
    options?.lifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled;
  if (!lifecycle) return false;

  const substrate =
    options?.substrateAvailable ?? isSandboxV2Available();
  if (!substrate) return false;

  const registry = options?.registry ?? loadOperatorProjectReadRegistry();
  const approved = listApprovedReadProjectIds(registry);
  if (approved.length === 0) return false;
  return approved.some((pid) => {
    const resolution = registry.resolveReadRoot(pid);
    if (!resolution?.ok) return false;
    return (
      resolution.entry.patchExportAllowed === true &&
      typeof resolution.entry.exportDestinationCanonicalRoot === "string" &&
      resolution.entry.exportDestinationCanonicalRoot.length > 0
    );
  });
}

export class AgentProjectRegistry {
  private registry: ProjectRootRegistry;

  constructor(entries: ReadonlyArray<ProjectRootEntry>) {
    const validated = validateProjectRootRegistry(entries);
    if (!validated.ok) {
      throw new Error(`agent_project_registry_invalid:${validated.reasons.join(",")}`);
    }
    this.registry = validated.registry;
  }

  /** Reload from a host-provided JSON file (operator action, not model action). */
  static loadFromFile(path: string): AgentProjectRegistry {
    const raw = JSON.parse(readFileSync(path, "utf8")) as ProjectRootEntry[];
    return new AgentProjectRegistry(raw);
  }

  list(): ProjectRootEntry[] {
    return [...this.registry.entries.values()];
  }

  get(projectId: string): ProjectRootEntry | null {
    return this.registry.entries.get(projectId) ?? null;
  }

  isReadAllowed(projectId: string): boolean {
    return this.get(projectId)?.readAllowed ?? false;
  }

  isEngineeringAllowed(projectId: string): boolean {
    return this.get(projectId)?.engineeringAllowed ?? false;
  }

  isWorkspaceAllowed(projectId: string): boolean {
    return this.get(projectId)?.candidateWorkspaceAllowed ?? false;
  }

  isVerificationAllowed(projectId: string): boolean {
    return this.get(projectId)?.verificationAllowed === true;
  }

  isAuthorshipAllowed(projectId: string): boolean {
    return this.get(projectId)?.authorshipAllowed === true;
  }
}
