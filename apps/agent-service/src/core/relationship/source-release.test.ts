import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { insertAssertion } from "../memory/assertions.js";
import { openNuclearDb } from "../db.js";
import { issueSourceControlledDisclosureLicense } from "./source-release.js";

describe("source-controlled disclosure release", () => {
  it("rejects a source attempting to release another principal's protection", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const assertionId = insertAssertion(db, {
      ownerId: "owner-1",
      kind: "episode_claim",
      subjectFacet: "unknown",
      lineageKind: "owner_designated",
      derivationKind: "observed",
      supportState: "supported",
      influenceClass: "I0",
      claimText: "a protected fact",
      sourceKind: "conversation",
      entityUuid: "assertion-1",
      dataClassification: "sensitive",
      speakerPrincipal: "lyra",
      audienceScope: { kind: "owner_private" },
      sourceEvidenceRef: "evidence-1",
      protectionSubjects: ["jeff"],
      protectionBasisRefs: ["evidence-1"],
      protectionStatus: "admitted",
    });

    expect(() =>
      issueSourceControlledDisclosureLicense(db, {
        assertionId,
        sourcePrincipal: "lyra",
        granteeAudience: { kind: "dm", principalId: "person-2" },
        controlledProtections: ["jeff"],
        grantRef: "grant-1",
        usesAllowed: 1,
      }),
    ).toThrow("not_entitled");
  });
});
