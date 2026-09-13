import { randomUUID } from "node:crypto";
import type { ObservationRequest } from "../types.js";

export type OperationClass = "observation" | "effect";
const READ_OPERATIONS = new Set([
  "project.read_file",
  "project.inspect",
  "workspace.read_file",
  "read_file",
  "conversation.read",
  "memory.lookup",
]);

export function classifyOperation(kind: string, _request: unknown): OperationClass {
  return READ_OPERATIONS.has(kind) ? "observation" : "effect";
}

export function createObservationRequest(input: {
  requestId?: string;
  cycleId: string;
  generation: number;
  kind: string;
  request: unknown;
}): ObservationRequest {
  if (classifyOperation(input.kind, input.request) !== "observation") throw new Error("operation_is_effectful");
  return {
    requestId: input.requestId ?? randomUUID(),
    cycleId: input.cycleId,
    generation: input.generation,
    kind: input.kind,
    request: input.request,
    replaySafe: true,
  };
}
