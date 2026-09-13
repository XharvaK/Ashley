import { createHash } from "node:crypto";
import type {
  CapabilityReality,
  IdentitySlice,
  LearnedSelfSlice,
} from "../types.js";
import { loadNuclearSystemPrompt } from "../../conversation/prompts.js";

/** Implementation default only. This is not an architectural prompt-size law. */
export const DEFAULT_INLINE_STABLE_SELF_BOUND = 3 as const;

export type StableSelfPointer = Readonly<{
  id: string;
  entityId: string;
  canonicalStore: "nuclear.db:identity_entries";
  status: "eligible";
  ordinal: number;
}>;

export type IdentityOrientationKernel = Readonly<{
  values: readonly string[];
  boundaries: readonly string[];
  /** The bounded stable-self text that is allowed into the ordinary prompt. */
  selectedStableSelf: readonly string[];
  /** Compatibility name for callers that refer to the selected slice as stableSelf. */
  stableSelf: readonly string[];
  /** Remaining stable-self records are represented by IDs only. */
  stableSelfRemainder: readonly StableSelfPointer[];
  stableSelfPointers: readonly StableSelfPointer[];
  /** Full static contract content. The hash is provenance metadata, not a substitute. */
  staticOperatingContract: string;
  staticContractHash: string;
  capabilityReality: CapabilityReality;
}>;

export type StableSelfEntry = Readonly<{
  id: string;
  text: string;
  /** Optional source order supplied by the canonical reader. */
  sourceOrder?: number;
}>;

export type IdentityOrientationSource = {
  values?: readonly string[];
  boundaries?: readonly string[];
  stableSelf?: readonly string[];
  stableSelfEntries?: readonly StableSelfEntry[];
};

export type BuildOrientationKernelInput = {
  identity?: IdentityOrientationSource;
  /** Rich fields may be attached by the canonical identity reader. */
  constitution?: IdentitySlice & Partial<IdentityOrientationSource>;
  values?: readonly string[];
  boundaries?: readonly string[];
  stableSelf?: readonly string[];
  stableSelfEntries?: readonly StableSelfEntry[];
  capabilityReality?: CapabilityReality;
  staticOperatingContract?: string;
  stableSelfBound?: number;
  /** Category-separated input is intentional; learned self never enters this kernel. */
  learnedSelf?: LearnedSelfSlice;
  [key: string]: unknown;
};

const CAPABILITY_BOOLEAN_FIELDS = [
  "vision",
  "attachmentText",
  "conversationalRead",
  "webSearch",
  "canOfferProjectInspection",
  "canOfferWorkspace",
  "canOfferVerification",
  "canOfferAuthorship",
  "canOfferBoundedOperation",
  "canOfferPatchExport",
] as const;

function nonEmptyText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function requiredMissing(field: string): never {
  throw new Error(`orientation_kernel_required_missing:${field}`);
}

function capabilityRealityOrFail(value: unknown): CapabilityReality {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return requiredMissing("capabilityReality");
  }
  const candidate = value as Record<string, unknown>;
  if (CAPABILITY_BOOLEAN_FIELDS.some((field) => typeof candidate[field] !== "boolean")) {
    return requiredMissing("capabilityReality");
  }
  if (!Array.isArray(candidate.approvedProjectIds) || candidate.approvedProjectIds.some((id) => typeof id !== "string")) {
    return requiredMissing("capabilityReality");
  }
  if (candidate.operationCapabilities !== undefined && !Array.isArray(candidate.operationCapabilities)) {
    return requiredMissing("capabilityReality");
  }
  return {
    vision: candidate.vision as boolean,
    attachmentText: candidate.attachmentText as boolean,
    conversationalRead: candidate.conversationalRead as boolean,
    webSearch: candidate.webSearch as boolean,
    canOfferProjectInspection: candidate.canOfferProjectInspection as boolean,
    canOfferWorkspace: candidate.canOfferWorkspace as boolean,
    canOfferVerification: candidate.canOfferVerification as boolean,
    canOfferAuthorship: candidate.canOfferAuthorship as boolean,
    canOfferBoundedOperation: candidate.canOfferBoundedOperation as boolean,
    canOfferPatchExport: candidate.canOfferPatchExport as boolean,
    approvedProjectIds: [...(candidate.approvedProjectIds as string[])],
    ...(candidate.operationCapabilities === undefined
      ? {}
      : { operationCapabilities: [...(candidate.operationCapabilities as NonNullable<CapabilityReality["operationCapabilities"]>)] }),
  };
}

function staticContract(value: unknown): string {
  if (value !== undefined) {
    if (typeof value !== "string" || value.trim() === "") return requiredMissing("staticOperatingContract");
    return value;
  }
  // The static identity/medium operating contract is carried here in full.
  // The code-owned semantic output contract remains the Thought system
  // message, where it is already required for every dispatch.
  const generated = loadNuclearSystemPrompt("discord").trim();
  if (!generated) return requiredMissing("staticOperatingContract");
  return generated;
}

function stableSelfEntries(
  identity: IdentityOrientationSource,
  topLevel: BuildOrientationKernelInput,
): StableSelfEntry[] {
  const entries = identity.stableSelfEntries ?? topLevel.stableSelfEntries;
  if (entries) {
    return entries.flatMap((entry, index) => {
      if (typeof entry !== "object" || entry === null) return [];
      const text = typeof entry.text === "string" ? entry.text.trim() : "";
      const id = typeof entry.id === "string" && entry.id.trim() !== ""
        ? entry.id.trim()
        : `stable-self:${index}`;
      if (!text) return [];
      return [{ id, text, sourceOrder: Number.isSafeInteger(entry.sourceOrder) ? entry.sourceOrder : index }];
    }).sort((left, right) =>
      (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0) || left.id.localeCompare(right.id),
    );
  }
  const values = identity.stableSelf ?? topLevel.stableSelf ?? [];
  return nonEmptyText(values).map((text, index) => ({
    id: `stable-self:${index}`,
    text,
    sourceOrder: index,
  }));
}

function clonePointer(entry: StableSelfEntry, ordinal: number): StableSelfPointer {
  return Object.freeze({
    id: entry.id,
    entityId: entry.id,
    canonicalStore: "nuclear.db:identity_entries" as const,
    status: "eligible" as const,
    ordinal,
  });
}

/**
 * Build the bounded, category-separated identity input for Thought.
 * Host-provided extra fields are deliberately ignored; only canonical fields
 * named by this adapter can enter the returned kernel.
 */
export function buildOrientationKernel(
  input: BuildOrientationKernelInput,
): IdentityOrientationKernel {
  const identity = input.identity ?? input.constitution ?? {};
  const values = nonEmptyText(identity.values ?? input.values ?? input.constitution?.constitutional);
  const boundaries = nonEmptyText(identity.boundaries ?? input.boundaries);
  if (values.length === 0 && boundaries.length === 0) return requiredMissing("identity");

  const contract = staticContract(input.staticOperatingContract);
  const capabilityReality = capabilityRealityOrFail(input.capabilityReality);
  const bound = input.stableSelfBound ?? DEFAULT_INLINE_STABLE_SELF_BOUND;
  if (!Number.isSafeInteger(bound) || bound < 1) return requiredMissing("stableSelfBound");

  const entries = stableSelfEntries(identity, input);
  const selectedEntries = entries.slice(0, bound);
  const remainder = entries.slice(bound).map((entry, index) => clonePointer(entry, bound + index));
  const selectedStableSelf = selectedEntries.map((entry) => entry.text);
  const kernel = {
    values: Object.freeze(values),
    boundaries: Object.freeze(boundaries),
    selectedStableSelf: Object.freeze(selectedStableSelf),
    stableSelfRemainder: Object.freeze(remainder),
    staticOperatingContract: contract,
    staticContractHash: createHash("sha256").update(contract, "utf8").digest("hex"),
    capabilityReality,
  } as IdentityOrientationKernel;

  // These names are retained for in-process compatibility only. They are
  // aliases for the canonical fields above, not second model-visible
  // representations of the same identity payload.
  Object.defineProperties(kernel, {
    stableSelf: {
      value: kernel.selectedStableSelf,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    stableSelfPointers: {
      value: kernel.stableSelfRemainder,
      enumerable: false,
      writable: false,
      configurable: false,
    },
  });
  return Object.freeze(kernel);
}
