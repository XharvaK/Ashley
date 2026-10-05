import type { CommandCodeThoughtEffort, CommandCodeThoughtModelId } from "./policy.js";

export type CommandCodeTransportOutcome = "not_sent" | "sent_outcome_unknown" | "response_received";

export type CommandCodeBoundaryEvidence = Readonly<{
  backend: "command_code_api";
  requestedModelId: CommandCodeThoughtModelId;
  reasoningEffort: CommandCodeThoughtEffort;
  requestHash?: `sha256:${string}`;
  providerModel?: string | null;
  providerRequestId?: string | null;
  providerHttpStatus?: number | null;
  responseHash?: `sha256:${string}`;
  transportOutcome: CommandCodeTransportOutcome;
}>;

export type CommandCodeThoughtEvidence = Readonly<{
  schema: "ashley.command_code.thought_evidence.v1";
  backend: "command_code_api";
  providerInvocationId: string;
  providerAttemptId: string;
  thoughtInvocationId: string;
  conversationId: string | null;
  cycleId: string;
  generation: number;
  wakeId: string | null;
  requestedModelId: CommandCodeThoughtModelId;
  providerModel: string | null;
  reasoningEffort: CommandCodeThoughtEffort;
  requestHash: `sha256:${string}` | null;
  responseHash: `sha256:${string}` | null;
  providerRequestId: string | null;
  providerHttpStatus: number | null;
  providerAttempts: number;
  alternateProviderAttempts: 0;
  transportOutcome: CommandCodeTransportOutcome;
  failureClass?: string;
}>;

const BOUNDARY_KEY = "__ashley_command_code_boundary_evidence" as const;
const THOUGHT_KEY = "__ashley_command_code_thought_evidence" as const;

function attach<T>(error: unknown, key: string, value: T): void {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return;
  Object.defineProperty(error, key, {
    configurable: true,
    enumerable: false,
    value,
    writable: true,
  });
}

function evidence<T>(error: unknown, key: string): T | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return value && typeof value === "object" ? value as T : undefined;
}

export function attachCommandCodeBoundaryEvidence(
  error: unknown,
  value: CommandCodeBoundaryEvidence,
): void {
  attach(error, BOUNDARY_KEY, value);
}

export function commandCodeBoundaryEvidenceFromError(
  error: unknown,
): CommandCodeBoundaryEvidence | undefined {
  return evidence(error, BOUNDARY_KEY);
}

export function attachCommandCodeThoughtEvidence(
  error: unknown,
  value: CommandCodeThoughtEvidence,
): void {
  attach(error, THOUGHT_KEY, value);
}

export function commandCodeThoughtEvidenceFromError(
  error: unknown,
): CommandCodeThoughtEvidence | undefined {
  return evidence(error, THOUGHT_KEY);
}
