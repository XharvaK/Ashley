import { createHash } from "node:crypto";
import type {
  Stance,
  ThoughtSettlementDraft,
} from "../types.js";

export type ExpressionAdapterInput = {
  draft: string;
  commitments?: ThoughtSettlementDraft["commitments"];
  stance?: Stance;
  directives?: readonly string[];
  profile: string;
  medium: "discord";
};

export type ExpressionAdapterOptions = {
  complete?: (prompt: string, input: ExpressionAdapterInput) => Promise<string> | string;
};

const FORBIDDEN_EVIDENCE_MARKERS = [
  "hotmessages",
  "mem_facts",
  "perceptionexpressionparts",
  "workspace",
  "transcript",
];

export function assertNoForbiddenEvidence(value: string): void {
  const lower = value.toLowerCase();
  const marker = FORBIDDEN_EVIDENCE_MARKERS.find((item) => lower.includes(item));
  if (marker) throw new Error(`expression_forbidden_evidence:${marker}`);
}

function promptParts(input: ExpressionAdapterInput): { system: string; user: string } {
  const system = [
    "You are Ashley's optional Expression adapter.",
    "Rewrite only the supplied Thought draft for Discord presentation.",
    "Do not add facts, commitments, referents, or actions.",
  ].join(" ");
  const user = JSON.stringify({
    draft: input.draft,
    commitments: input.commitments,
    stance: input.stance,
    directives: [...(input.directives ?? [])],
    profile: input.profile,
    medium: input.medium,
  });
  return { system, user };
}

export function expressionPromptHash(input: ExpressionAdapterInput): string {
  const parts = promptParts(input);
  return createHash("sha256").update(parts.system).update("\n").update(parts.user).digest("hex");
}

/**
 * Evidence-starved optional adapter. Extra runtime properties are ignored by
 * construction of the prompt, so owner logs cannot enter this layer by accident.
 */
export async function adaptExpression(
  input: ExpressionAdapterInput,
  options: ExpressionAdapterOptions = {},
): Promise<string> {
  const parts = promptParts(input);
  assertNoForbiddenEvidence(parts.system);
  assertNoForbiddenEvidence(parts.user);
  if (!options.complete) return input.draft;
  const output = await options.complete(`${parts.system}\n${parts.user}`, input);
  if (typeof output !== "string" || output.trim().length === 0) {
    throw new Error("expression_empty_output");
  }
  return output;
}
