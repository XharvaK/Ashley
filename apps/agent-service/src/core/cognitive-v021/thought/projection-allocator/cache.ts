import { createHash } from "node:crypto";
import type { AuthorityCode } from "../../types.js";
import type { ThoughtSourceCurrentness } from "../source-currentness.js";
import { stableJson } from "../../../model-fabric/hash.js";

export type SemanticPassKeyInput = {
  cycleId: string;
  generation: number;
  pass: number;
  observationsCount: number;
  inFlightCount: number;
  authorityObjectionsHash: string;
  composeLogIds: string[];
  rememberDirectivePresent: boolean;
  sourceCurrentnessKey?: string;
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashAuthorityObjections(objections: AuthorityCode[]): string {
  if (!objections || objections.length === 0) return "none";
  return sha256([...objections].sort().join(","));
}

export function hashThoughtSourceCurrentness(
  currentness: ThoughtSourceCurrentness | undefined,
): string {
  return sha256(stableJson(currentness ?? null));
}

export function semanticPassKey(input: SemanticPassKeyInput): string {
  const sortedLogIds = [...(input.composeLogIds ?? [])].sort().join(",");
  return [
    input.cycleId,
    input.generation,
    input.pass,
    input.observationsCount,
    input.inFlightCount,
    input.authorityObjectionsHash,
    sortedLogIds,
    input.rememberDirectivePresent ? "1" : "0",
    input.sourceCurrentnessKey ?? "none",
  ].join(":");
}

export class ProjectionCache<T> {
  private readonly entries = new Map<string, T>();

  get(key: string): T | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: T): void {
    this.entries.set(key, value);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
