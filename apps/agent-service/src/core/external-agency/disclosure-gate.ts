import { createHash } from "node:crypto";
import type { DataClassification } from "../privacy/classification.js";
import {
  ALL_ETH_PUB_PROTECTED,
  evaluatePublicDisclosure,
  type EthPubProtectedCategory,
} from "../privacy/disclosure.js";

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  return value;
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hashPublicDisclosureResult(input: {
  allowed: boolean;
  reason: string;
  protectedCategories: EthPubProtectedCategory[];
  classification: DataClassification | null | undefined;
}): string {
  return sha256Hex(
    canonicalJson({
      allowed: input.allowed,
      reason: input.reason,
      protectedCategories: [...input.protectedCategories].sort(),
      classification: input.classification ?? null,
    }),
  );
}

export function runPublicDisclosureGate(input: {
  classification: DataClassification | null | undefined;
  protectedCategories?: EthPubProtectedCategory[];
  conditionallyPublicAshleyMaterial?: boolean;
  thoughtAuthorized?: boolean;
}): {
  allowed: boolean;
  reason: string;
  publicDisclosureResultHash: string;
} {
  const protectedCategories = input.protectedCategories ?? [];
  const result = evaluatePublicDisclosure({
    classification: input.classification,
    protectedCategories,
    conditionallyPublicAshleyMaterial: input.conditionallyPublicAshleyMaterial,
    thoughtAuthorized: input.thoughtAuthorized,
  });
  const publicDisclosureResultHash = hashPublicDisclosureResult({
    allowed: result.allowed,
    reason: result.reason,
    protectedCategories,
    classification: input.classification,
  });
  return { ...result, publicDisclosureResultHash };
}

export { ALL_ETH_PUB_PROTECTED };
