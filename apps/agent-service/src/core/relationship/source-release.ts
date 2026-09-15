import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAssertion } from "../memory/assertions.js";
import { issueLicense, type DisclosureLicense } from "./social-authority.js";

export type SourceControlledDisclosureInput = {
  assertionId: number;
  sourcePrincipal: string;
  granteeAudience: unknown;
  /** References to protections/basis rows the admitted record establishes as controlled. */
  controlledProtections: string[];
  grantRef: string;
  usesAllowed: number;
  expiresAt?: string | null;
  nowMs?: number;
  entityUuid?: string;
};

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function materialHashForAssertion(assertion: ReturnType<typeof getAssertion>): string {
  if (!assertion) throw new Error("not_entitled");
  return createHash("sha256")
    .update(JSON.stringify({
      assertionId: assertion.id,
      entityUuid: assertion.entityUuid,
      claimText: assertion.claimText,
      sourceEvidenceRef: assertion.sourceEvidenceRef,
      protectionBasisRefs: assertion.protectionBasisRefs,
    }), "utf8")
    .digest("hex");
}

/**
 * Issue the narrow own-material disclosure license permitted by §8.3.
 * The helper only uses an already-admitted nuclear assertion as its
 * entitlement record; it never infers control from free text or bare identity
 * equality with a protected subject.
 */
export function issueSourceControlledDisclosureLicense(
  db: DatabaseSync,
  input: SourceControlledDisclosureInput,
): DisclosureLicense {
  const sourcePrincipal = required(input.sourcePrincipal, "not_entitled");
  const assertion = getAssertion(db, input.assertionId);
  const subjects = assertion?.protectionSubjects ?? [];
  const basisRefs = assertion?.protectionBasisRefs ?? [];
  const controlled = Array.isArray(input.controlledProtections)
    ? input.controlledProtections.filter((ref) => typeof ref === "string" && ref.trim())
    : [];

  // A source may release only an admitted protection reference explicitly
  // established by the record. A record about Jeff that is merely spoken by
  // Lyra therefore cannot be released by Lyra using "jeff" as a control ref.
  const entitled = assertion !== null &&
    assertion.protectionStatus === "admitted" &&
    assertion.speakerPrincipal === sourcePrincipal &&
    subjects.length > 0 &&
    basisRefs.length > 0 &&
    controlled.length > 0 &&
    controlled.every((ref) => basisRefs.includes(ref));
  if (!entitled) throw new Error("not_entitled");

  return issueLicense(db, {
    ownerId: assertion.ownerId,
    materialHash: materialHashForAssertion(assertion),
    sourcePrincipal,
    controlledProtections: controlled,
    granteeAudience: input.granteeAudience,
    usesAllowed: input.usesAllowed,
    grantRef: required(input.grantRef, "license_grant_ref_required"),
    expiresAt: input.expiresAt,
    nowMs: input.nowMs,
    entityUuid: input.entityUuid,
  });
}

export const issueSourceControlledLicense = issueSourceControlledDisclosureLicense;

export { materialHashForAssertion };
