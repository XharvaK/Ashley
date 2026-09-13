/**
 * Operator-owned project read registry (Sandbox V2 M2).
 *
 * The model/user may identify ONLY a projectId. The registry resolves that id
 * to an operator-owned allowlisted canonical host root; the model can never
 * supply an arbitrary host absolute path, can never create or widen a project
 * root, and can never alter registry authorization.
 *
 * The registry is immutable after construction. A project that is not
 * explicitly read-authorized (missing, disabled, or read-denied) fails closed.
 */

import {
  validateProjectRootRegistry,
  type ProjectRootEntry,
  type ProjectRootRegistry,
} from "@composer-assistant/sandbox-policy";
import { readFileSync } from "node:fs";
import { V2_LIMITS } from "./limits.js";

export type ProjectReadResolution =
  | { ok: true; entry: ProjectRootEntry }
  | { ok: false; error: string };

export class V2ProjectReadRegistry {
  private registry: ProjectRootRegistry;

  constructor(entries: ReadonlyArray<ProjectRootEntry>) {
    const validated = validateProjectRootRegistry(entries);
    if (!validated.ok) {
      throw new Error(`v2_project_registry_invalid:${validated.reasons.join(",")}`);
    }
    this.registry = validated.registry;
  }

  /** Reload from a host/operator-provided JSON file (operator action, not model action). */
  static loadFromFile(path: string): V2ProjectReadRegistry {
    const raw = JSON.parse(readFileSync(path, "utf8")) as ProjectRootEntry[];
    return new V2ProjectReadRegistry(raw);
  }

  list(): ProjectRootEntry[] {
    return [...this.registry.entries.values()];
  }

  /**
   * Resolve a projectId to an explicitly read-authorized project root.
   * Fail-closed: unknown, disabled, and read-denied projects are refused.
   */
  resolveReadRoot(projectId: string): ProjectReadResolution {
    if (typeof projectId !== "string" || projectId.length === 0) {
      return { ok: false, error: "project_id_invalid" };
    }
    if (projectId.length > V2_LIMITS.PROJECT_ID_MAX) {
      return { ok: false, error: "project_id_invalid" };
    }
    const entry = this.registry.entries.get(projectId);
    if (!entry) return { ok: false, error: "unknown_project" };
    if (!entry.enabled) return { ok: false, error: "project_disabled" };
    if (!entry.readAllowed) return { ok: false, error: "read_not_allowed" };
    return { ok: true, entry };
  }
}