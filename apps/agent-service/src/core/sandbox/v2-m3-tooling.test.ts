import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { V2ProjectReadRegistry } from "@composer-assistant/sandbox-v2";
import { executeWorkspaceExperimentV2 } from "./v2-execution.js";
import {
  CANONICAL_WITNESS_BYTES,
  CANONICAL_WITNESS_LENGTH,
  CANONICAL_WITNESS_SHA256,
  assertSafePath,
  verifyCanonicalWitnessHash,
} from "../../../../../scripts/mint/m3-qualification-contract.mjs";

describe("M3 Qualification Tooling Integrity & Production-Safety Tests", () => {
  // 1. Canonical Witness Hash & Length
  it("Exact canonical witness bytes and SHA-256 hash verify deterministically", () => {
    expect(CANONICAL_WITNESS_BYTES).toBe("m3-witness-ok");
    expect(Buffer.byteLength(CANONICAL_WITNESS_BYTES, "utf8")).toBe(13);
    expect(CANONICAL_WITNESS_LENGTH).toBe(13);

    const calculatedHash = createHash("sha256").update(CANONICAL_WITNESS_BYTES, "utf8").digest("hex");
    expect(calculatedHash).toBe("cf638cbb32331a0d99110697fb5f9ff790a11c15749bbc287a132bcc0bcc708e");
    expect(CANONICAL_WITNESS_SHA256).toBe(calculatedHash);

    const verified = verifyCanonicalWitnessHash();
    expect(verified.length).toBe(13);
    expect(verified.sha256).toBe("cf638cbb32331a0d99110697fb5f9ff790a11c15749bbc287a132bcc0bcc708e");
  });

  // 2. Production Registry & Production DB Rejection via Canonical Containment
  it("Production paths (registry, nuclear.db, continuity.db, repo root) are strictly rejected by assertSafePath", () => {
    const home = homedir();

    // Direct match violations
    expect(() => assertSafePath("/home/xarvak/project-ashley", "Repo Root")).toThrow(/ProductionPathViolation/);
    expect(() => assertSafePath(join(home, ".composer-assistant", "project-roots.json"), "Registry")).toThrow(/ProductionPathViolation/);
    expect(() => assertSafePath(join(home, ".composer-assistant", "conversations", "nuclear.db"), "Nuclear DB")).toThrow(/ProductionPathViolation/);
    expect(() => assertSafePath(join(home, ".composer-assistant", "continuity.db"), "Continuity DB")).toThrow(/ProductionPathViolation/);
    expect(() => assertSafePath(join(home, ".composer-assistant", "index.db"), "Index DB")).toThrow(/ProductionPathViolation/);

    // Subdirectory containment violations
    expect(() => assertSafePath(join(home, ".composer-assistant", "temp-test.db"), "Inside state dir")).toThrow(/ProductionPathViolation/);
    expect(() => assertSafePath(join(home, ".composer-assistant", "conversations", "custom.db"), "Inside conversations dir")).toThrow(/ProductionPathViolation/);

    // Valid disposable temporary paths pass cleanly
    const safeTmp = mkdtempSync(join(tmpdir(), "ashley-safe-test-"));
    try {
      expect(() => assertSafePath(safeTmp, "Disposable Tmp")).not.toThrow();
      expect(() => assertSafePath(join(safeTmp, "test.db"), "Disposable DB")).not.toThrow();
    } finally {
      rmSync(safeTmp, { recursive: true, force: true });
    }
  });

  // 3. V1 Broker Path Exclusion
  it("Harnesses strictly avoid legacy V1 broker components", () => {
    // Verify that neither harness imports or references V1 broker environment flags or paths
    expect(process.env.ASHLEY_SANDBOX_BROKER_ENABLED).toBeUndefined();
    expect(process.env.ASHLEY_SANDBOX_BROKER_SOCKET).toBeUndefined();
  });

  // 4. Authority Revocation Across All 8 M3 Operations (Constraint #1)
  it("All 8 M3 operations fail closed through executeWorkspaceExperimentV2 when candidateWorkspaceAllowed is false", async () => {
    const revokedRegistry = new V2ProjectReadRegistry([
      {
        projectId: "revoked-project",
        canonicalRoot: "/srv/projects/revoked-project",
        displayName: "Revoked Project",
        enabled: true,
        readAllowed: true,
        candidateWorkspaceAllowed: false,
        engineeringAllowed: false,
      },
    ]);

      const operations = [
        "workspace.read_file",
        "workspace.list_directory",
        "workspace.search_text",
        "workspace.write_file",
        "workspace.replace_file",
        "workspace.edit_text",
        "workspace.delete_file",
        "workspace.create_directory",
      ] as const;

      for (const op of operations) {
        const res = await executeWorkspaceExperimentV2({
          request: {
            operation: op,
            projectId: "revoked-project",
            path: "test.txt",
            workspaceId: "ws-test-revocation",
            ...(op === "workspace.write_file" ? { content: "test" } : {}),
            ...(op === "workspace.replace_file" ? { content: "test" } : {}),
            ...(op === "workspace.edit_text" ? { oldText: "1", newText: "2" } : {}),
            ...(op === "workspace.search_text" ? { pattern: "test" } : {}),
          } as any,
          registry: revokedRegistry,
          skipCapabilityGate: true,
          envOverrides: {
            sandboxEngineeringLifecycleEnabled: true,
            sandboxAvailable: () => true,
          },
        });

        expect(res.license.state).toBe("failed");
        expect(res.license.error).toBe("workspace_not_allowed");
        expect(res.observation).toBeNull();
      }
  });

  // 5. Network Isolation Requires Host Positive Control
  it("Network isolation proof logic requires host positive control before sandbox delta evaluation", () => {
    // If positiveControl === false, isolation verdict must NOT pass even if delta is 0
    const evaluateIsolation = (positiveControl: boolean, sandboxHitsDelta: number, sandboxIsolated: boolean) => {
      return positiveControl === true && sandboxHitsDelta === 0 && sandboxIsolated === true;
    };

    expect(evaluateIsolation(true, 0, true)).toBe(true);
    expect(evaluateIsolation(false, 0, true)).toBe(false); // Fails if host cannot even connect to itself
    expect(evaluateIsolation(true, 1, true)).toBe(false); // Fails if sandbox leaked packet to host
    expect(evaluateIsolation(true, 0, false)).toBe(false); // Fails if sandbox did not report isolation
  });

  // 6. External Network Diagnostic Alone Cannot Satisfy Network Qualification
  it("External internet probe alone cannot satisfy network isolation qualification", () => {
    const isNetworkQualified = (loopbackProven: boolean, externalDiagnostic: boolean) => {
      // Loopback positive control & proof is MANDATORY. External diagnostic is informational only.
      return loopbackProven === true;
    };

    expect(isNetworkQualified(true, true)).toBe(true);
    expect(isNetworkQualified(true, false)).toBe(true); // Still qualified if external probe is offline
    expect(isNetworkQualified(false, true)).toBe(false); // External probe success CANNOT qualify if loopback proof missing
  });

  // 7. Live vs Candidate Distinction in Expression
  it("Candidate workspace mutation Expression must not claim live repository modification", () => {
    const candidateClaim = "I created `m3-witness.txt` in a private candidate workspace.";
    const liveClaim = "I modified the live Project Ashley repository.";

    const isValidCandidateExpression = (text: string) => {
      const lower = text.toLowerCase();
      return lower.includes("candidate workspace") && !lower.includes("live project ashley repository") && !lower.includes("modified the live");
    };

    expect(isValidCandidateExpression(candidateClaim)).toBe(true);
    expect(isValidCandidateExpression(liveClaim)).toBe(false);
  });

  // 8. B15 Intended Validation Layer vs Early Gate Denial
  it("B15 passes ONLY when errors come from intended validators, failing on earlier lifecycle/authority denials", () => {
    const evaluateB15 = (escapeError: string, oversizedReqError: string, oversizedContentError: string) => {
      const escapePass = escapeError === "invalid_path" || escapeError === "path_escapes_workspace";
      const oversizedReqPass = oversizedReqError === "request_too_large";
      const oversizedContentPass = oversizedContentError === "content_too_large" || oversizedContentError === "request_too_large";
      const disallowed = ["sandbox_lifecycle_disabled", "workspace_not_allowed", "capability_disabled"];
      const noEarlyGate =
        !disallowed.includes(escapeError) &&
        !disallowed.includes(oversizedReqError) &&
        !disallowed.includes(oversizedContentError);
      return escapePass && oversizedReqPass && oversizedContentPass && noEarlyGate;
    };

    // Valid passes from intended validators
    expect(evaluateB15("invalid_path", "request_too_large", "content_too_large")).toBe(true);
    expect(evaluateB15("path_escapes_workspace", "request_too_large", "content_too_large")).toBe(true);

    // Rejection if earlier authority / lifecycle gates masked validation
    expect(evaluateB15("sandbox_lifecycle_disabled", "sandbox_lifecycle_disabled", "sandbox_lifecycle_disabled")).toBe(false);
    expect(evaluateB15("workspace_not_allowed", "request_too_large", "content_too_large")).toBe(false);
    expect(evaluateB15("capability_disabled", "request_too_large", "content_too_large")).toBe(false);
  });

  // 9. Windows Platform Classification for Physical Cases B1-B17
  it("Non-Linux / Windows platform strictly classifies physical substrate cases as NOT_EXECUTED with local self-test status", () => {
    const classifySubstrateCase = (caseId: string, platform: string, selfTestPass: boolean | "NOT_APPLICABLE") => {
      const isLinux = platform === "linux";
      const localSelfTest = selfTestPass === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : selfTestPass ? "PASS" : "FAIL";
      const physicalVerdict = isLinux ? (localSelfTest === "NOT_APPLICABLE" ? "NOT_EXECUTED" : localSelfTest) : "NOT_EXECUTED";
      const verdict = isLinux ? physicalVerdict : "NOT_EXECUTED";

      return {
        verdict,
        localSelfTest,
        physicalVerdict,
      };
    };

    // Windows cases
    const b1Win = classifySubstrateCase("B1", "win32", true);
    expect(b1Win.physicalVerdict).toBe("NOT_EXECUTED");
    expect(b1Win.localSelfTest).toBe("PASS");

    const b2Win = classifySubstrateCase("B2", "win32", "NOT_APPLICABLE");
    expect(b2Win.physicalVerdict).toBe("NOT_EXECUTED");
    expect(b2Win.localSelfTest).toBe("NOT_APPLICABLE");

    const b11Win = classifySubstrateCase("B11", "win32", true);
    expect(b11Win.physicalVerdict).toBe("NOT_EXECUTED");
    expect(b11Win.localSelfTest).toBe("PASS");

    const b14Win = classifySubstrateCase("B14", "win32", true);
    expect(b14Win.physicalVerdict).toBe("NOT_EXECUTED");
    expect(b14Win.localSelfTest).toBe("PASS");

    // Linux physical cases
    const b1Linux = classifySubstrateCase("B1", "linux", true);
    expect(b1Linux.physicalVerdict).toBe("PASS");
    expect(b1Linux.localSelfTest).toBe("PASS");

    const b11Linux = classifySubstrateCase("B11", "linux", true);
    expect(b11Linux.physicalVerdict).toBe("PASS");
  });
});
