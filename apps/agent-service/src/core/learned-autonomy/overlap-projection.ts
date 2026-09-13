import type { DatabaseSync } from "node:sqlite";
import { listAssertions } from "../memory/assertions.js";
import { influenceEligibleAt } from "../memory/eligibility.js";
import { assertC3ContractCompatible } from "./contract-state.js";
import type { CurrentSharedOverlap } from "./types.js";

function normalize(text: string): string {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((token) => token.length >= 4));
}

function overlaps(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  let common = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) common++;
  return common >= 2 && common / Math.max(leftTokens.size, rightTokens.size) >= 0.75;
}

/**
 * Ephemeral current overlap only. The result is a projection, not a third
 * identity and not a learned-influence row.
 */
export function computeCurrentSharedOverlap(
  db: DatabaseSync,
  ownerId: string,
  at = new Date(),
): CurrentSharedOverlap[] {
  assertC3ContractCompatible(db);
  const current = listAssertions(db, ownerId).filter((assertion) =>
    (assertion.subjectFacet === "owner_model" || assertion.subjectFacet === "ashley_side") &&
    influenceEligibleAt(db, assertion.id, at.toISOString()),
  );
  const owner = current.filter((assertion) => assertion.subjectFacet === "owner_model");
  const ashley = current.filter((assertion) => assertion.subjectFacet === "ashley_side");
  const result: CurrentSharedOverlap[] = [];
  for (const ownerAssertion of owner) {
    const ownerText = ownerAssertion.claimText ?? `${ownerAssertion.key ?? ""} ${ownerAssertion.value ?? ""}`;
    for (const ashleyAssertion of ashley) {
      const ashleyText = ashleyAssertion.claimText ?? `${ashleyAssertion.key ?? ""} ${ashleyAssertion.value ?? ""}`;
      if (!overlaps(ownerText, ashleyText)) continue;
      result.push({
        key: normalize(ownerText),
        ownerAssertionId: ownerAssertion.id,
        ashleyAssertionId: ashleyAssertion.id,
        ownerText,
        ashleyText,
      });
    }
  }
  return result;
}
