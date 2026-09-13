import { describe, it, expect } from "vitest";
import {
  executeProjectInspectionV2,
  executeWorkspaceExperimentV2,
  executeReactiveSandboxTaskV2,
} from "./v2-execution.js";
import {
  loadOperatorProjectReadRegistry,
  listApprovedReadProjectIds,
  canOfferProjectInspection,
  canOfferCandidateWorkspace,
  V2ProjectReadRegistry,
} from "./project-registry.js";
import {
  formatSandboxV2LicenseAudit,
  type SandboxV2LicenseAuditRecord,
} from "./v2-license-audit.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import {
  currentReleaseId,
  currentContractId,
  currentBuildIdentity,
  capabilityNames,
} from "../rollout/capabilities.js";
import type {
  SandboxV2Dispatcher,
  SandboxV2Request,
  SandboxV2Result,
} from "@composer-assistant/sandbox-v2";

describe("Sandbox V2 Execution Adapter & Operator Registry", () => {
  describe("Operator Project Registry & Offer Gating", () => {
    it("fails closed when unconfigured or non-existent", () => {
      const registry = loadOperatorProjectReadRegistry("/non/existent/path.json");
      expect(registry.list()).toHaveLength(0);
      const res = registry.resolveReadRoot("project-ashley");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("unknown_project");
      }
    });

    it("loads valid registry and returns only safe string IDs in listApprovedReadProjectIds", () => {
      const tmp = mkdtempSync(join(tmpdir(), "v2-reg-test-"));
      const configPath = join(tmp, "registry.json");
      writeFileSync(
        configPath,
        JSON.stringify([
          {
            projectId: "project-ashley",
            canonicalRoot: "/home/xarvak/project-ashley",
            displayName: "Ashley",
            enabled: true,
            readAllowed: true,
            candidateWorkspaceAllowed: false,
            engineeringAllowed: false,
          },
          {
            projectId: "disabled-project",
            canonicalRoot: "/home/xarvak/disabled-project",
            displayName: "Disabled",
            enabled: false,
            readAllowed: true,
            candidateWorkspaceAllowed: false,
            engineeringAllowed: false,
          },
          {
            projectId: "no-read-project",
            canonicalRoot: "/home/xarvak/no-read-project",
            displayName: "No Read",
            enabled: true,
            readAllowed: false,
            candidateWorkspaceAllowed: false,
            engineeringAllowed: false,
          },
        ]),
      );

      try {
        const registry = loadOperatorProjectReadRegistry(configPath);
        expect(registry.list()).toHaveLength(3);

        const approved = listApprovedReadProjectIds(registry);
        expect(approved).toEqual(["project-ashley"]);
        // Ensure no host paths leaked
        expect(approved.some((id) => id.includes("/") || id.includes("\\"))).toBe(false);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("evaluates canOfferProjectInspection across capability, lifecycle, substrate, and registry", () => {
      const path = join(tmpdir(), `ashley-offer-gate-${Date.now()}.db`);
      const db = openNuclearDb(new DatabaseSync(path), {
        continuity: openContinuityDb(new DatabaseSync(":memory:")),
      });
      const registry = new V2ProjectReadRegistry([
        {
          projectId: "project-ashley",
          canonicalRoot: "/home/xarvak/project-ashley",
          displayName: "Ashley",
          enabled: true,
          readAllowed: true,
          candidateWorkspaceAllowed: false,
          engineeringAllowed: false,
        },
      ]);

      try {
        // Default capability state is 'observe' -> cannot offer
        expect(
          canOfferProjectInspection(db, {
            registry,
            lifecycleEnabled: true,
            substrateAvailable: true,
          }),
        ).toBe(false);

        // Activate project_inspection and dependencies
        const relId = currentReleaseId();
        const now = new Date().toISOString();
        for (const cap of capabilityNames) {
          db.prepare(
            `INSERT OR REPLACE INTO capability_releases (capability, release_id, state, updated_at, contract_id, build_identity, model_epoch)
             VALUES (?, ?, 'active', ?, ?, ?, 0)`,
          ).run(cap, relId, now, currentContractId(), currentBuildIdentity());
        }

        // With capability active, lifecycle true, substrate true, registry non-empty -> returns true
        expect(
          canOfferProjectInspection(db, {
            registry,
            lifecycleEnabled: true,
            substrateAvailable: true,
            masterMode: "apply",
          }),
        ).toBe(true);

        // Lifecycle disabled -> false
        expect(
          canOfferProjectInspection(db, {
            registry,
            lifecycleEnabled: false,
            substrateAvailable: true,
          }),
        ).toBe(false);

        // Substrate unavailable -> false
        expect(
          canOfferProjectInspection(db, {
            registry,
            lifecycleEnabled: true,
            substrateAvailable: false,
          }),
        ).toBe(false);

        // Empty registry -> false
        expect(
          canOfferProjectInspection(db, {
            registry: new V2ProjectReadRegistry([]),
            lifecycleEnabled: true,
            substrateAvailable: true,
          }),
        ).toBe(false);
      } finally {
        db.close();
        try {
          rmSync(path, { force: true });
        } catch {}
      }
    });
  });

  describe("executeProjectInspectionV2", () => {
    const REACTIVE_DEADLINES = {
      projectInspectionPreparationDeadlineAtMs: Date.now() + 60_000,
      childExecutionDeadlineAtMs: Date.now() + 66_000,
      childTerminationDeadlineAtMs: Date.now() + 66_500,
      settlementDeadlineAtMs: Date.now() + 70_000,
    };

    it("fails immediately when settlementDeadlineAtMs is already exceeded", async () => {
      const res = await executeProjectInspectionV2({
        ...REACTIVE_DEADLINES,
        request: {
          operation: "project.read_file",
          projectId: "project-ashley",
          path: "src/index.ts",
        },
        settlementDeadlineAtMs: Date.now() - 50,
      });

      expect(res.license.state).toBe("failed");
      expect(res.license.error).toBe("deadline_exceeded");
      expect(res.license.profile).toBe("project_investigation");
      expect(res.observation).toBeNull();
      expect(res.dispatchAttempted).toBe(false);
    });

    it("fails closed with project_inspection_gate_denied when capability is in observe mode", async () => {
      const path = join(tmpdir(), `ashley-cap-gate-${Date.now()}.db`);
      const db = openNuclearDb(new DatabaseSync(path), {
        continuity: openContinuityDb(new DatabaseSync(":memory:")),
      });

      try {
        const res = await executeProjectInspectionV2({
          ...REACTIVE_DEADLINES,
          request: {
            operation: "project.read_file",
            projectId: "project-ashley",
            path: "src/index.ts",
          },
          db,
        });

        expect(res.license.state).toBe("none");
        expect(res.license.error).toBe("project_inspection_gate_denied");
        expect(res.observation).toBeNull();
      } finally {
        db.close();
        try {
          rmSync(path, { force: true });
        } catch {}
      }
    });

    it("returns state=none, error=sandbox_lifecycle_disabled when lifecycle is disabled", async () => {
      const res = await executeProjectInspectionV2({
        ...REACTIVE_DEADLINES,
        request: {
          operation: "project.read_file",
          projectId: "project-ashley",
          path: "src/index.ts",
        },
        envOverrides: {
          sandboxEngineeringLifecycleEnabled: false,
        },
      });

      expect(res.license.state).toBe("none");
      expect(res.license.error).toBe("sandbox_lifecycle_disabled");
      expect(res.observation).toBeNull();
    });

    it("returns state=none, error=sandbox_unavailable when substrate is unavailable", async () => {
      const registry = new V2ProjectReadRegistry([
        {
          projectId: "project-ashley",
          canonicalRoot: "/home/xarvak/project-ashley",
          displayName: "Ashley",
          enabled: true,
          readAllowed: true,
          candidateWorkspaceAllowed: false,
          engineeringAllowed: false,
        },
      ]);

      const res = await executeProjectInspectionV2({
        ...REACTIVE_DEADLINES,
        request: {
          operation: "project.read_file",
          projectId: "project-ashley",
          path: "src/index.ts",
        },
        registry,
        envOverrides: {
          sandboxAvailable: () => false,
          sandboxEngineeringLifecycleEnabled: true,
        },
      });

      expect(res.license.state).toBe("none");
      expect(res.license.profile).toBe("project_investigation");
      expect(res.license.error).toBe("sandbox_unavailable");
      expect(res.observation).toBeNull();
    });

    it("returns state=failed, error=invalid_result on malformed kernel read_file result", async () => {
      const mockResult: any = {
        outcome: "succeeded",
        operation: "project.read_file",
        executedAtMs: 123456789,
        result: {
          kind: "project.read_file",
          // missing contentBase64 and bytes
        },
      };

      const res = await executeProjectInspectionV2({
        ...REACTIVE_DEADLINES,
        request: {
          operation: "project.read_file",
          projectId: "project-ashley",
          path: "src/index.ts",
        },
        dispatcher: {
          dispatch: async () => mockResult,
        } as any,
        envOverrides: {
          sandboxEngineeringLifecycleEnabled: true,
        },
      });

      expect(res.license.state).toBe("failed");
      expect(res.license.error).toBe("invalid_result");
      expect(res.observation).toBeNull();
    });

    it("executes project.read_file successfully via custom dispatcher/spawn seam", async () => {
      const mockResult: SandboxV2Result = {
        outcome: "succeeded",
        operation: "project.read_file",
        executedAtMs: 123456789,
        result: {
          kind: "project.read_file",
          path: "src/index.ts",
          contentBase64: Buffer.from("console.log('hello world');").toString("base64"),
          bytes: 27,
          sha256: "abc123hash",
          truncated: false,
        },
      };

      const res = await executeProjectInspectionV2({
        ...REACTIVE_DEADLINES,
        request: {
          operation: "project.read_file",
          projectId: "project-ashley",
          path: "src/index.ts",
        },
        dispatcher: {
          dispatch: async (req: SandboxV2Request) => mockResult,
        } as any,
        envOverrides: {
          sandboxEngineeringLifecycleEnabled: true,
        },
      });

      expect(res.license.state).toBe("succeeded");
      expect(res.license.profile).toBe("project_investigation");
      expect(res.license.error).toBeUndefined();
      expect(res.observation).toEqual({
        projectId: "project-ashley",
        operation: "project.read_file",
        path: "src/index.ts",
        verified: true,
        truncated: false,
        executedAtMs: 123456789,
        contentUtf8: "console.log('hello world');",
        bytes: 27,
        sha256: "abc123hash",
      });
    });

    it("executes project.list_directory successfully with truncation flag preserved", async () => {
      const mockResult: SandboxV2Result = {
        outcome: "succeeded",
        operation: "project.list_directory",
        executedAtMs: 123456789,
        result: {
          kind: "project.list_directory",
          path: "src",
          entries: [
            { name: "index.ts", kind: "file", size: 100 },
            { name: "utils", kind: "dir", size: 0 },
          ],
          truncated: true,
        },
      };

      const res = await executeProjectInspectionV2({
        ...REACTIVE_DEADLINES,
        request: {
          operation: "project.list_directory",
          projectId: "project-ashley",
          path: "src",
        },
        dispatcher: {
          dispatch: async () => mockResult,
        } as any,
        envOverrides: {
          sandboxEngineeringLifecycleEnabled: true,
        },
      });

      expect(res.license.state).toBe("succeeded");
      expect(res.observation).toEqual({
        projectId: "project-ashley",
        operation: "project.list_directory",
        path: "src",
        verified: true,
        truncated: true,
        executedAtMs: 123456789,
        entries: [
          { name: "index.ts", kind: "file", size: 100 },
          { name: "utils", kind: "dir", size: 0 },
        ],
      });
    });

    it("executes project.search_text successfully with zero matches and truncation", async () => {
      const mockResult: SandboxV2Result = {
        outcome: "succeeded",
        operation: "project.search_text",
        executedAtMs: 123456789,
        result: {
          kind: "project.search_text",
          path: ".",
          matches: [],
          filesScanned: 50,
          truncated: true,
        },
      };

      const res = await executeProjectInspectionV2({
        ...REACTIVE_DEADLINES,
        request: {
          operation: "project.search_text",
          projectId: "project-ashley",
          pattern: "nonexistent_pattern",
        },
        dispatcher: {
          dispatch: async () => mockResult,
        } as any,
        envOverrides: {
          sandboxEngineeringLifecycleEnabled: true,
        },
      });

      expect(res.license.state).toBe("succeeded");
      expect(res.observation).toEqual({
        projectId: "project-ashley",
        operation: "project.search_text",
        path: ".",
        pattern: "nonexistent_pattern",
        verified: true,
        truncated: true,
        executedAtMs: 123456789,
        matches: [],
        filesScanned: 50,
      });
    });

    it("handles typed failure outcome cleanly", async () => {
      const mockResult: SandboxV2Result = {
        outcome: "failed",
        operation: "project.read_file",
        executedAtMs: 123456789,
        error: "not_found",
        cancellationRequested: true,
        cancellationAcknowledged: false,
      };

      const res = await executeProjectInspectionV2({
        ...REACTIVE_DEADLINES,
        request: {
          operation: "project.read_file",
          projectId: "project-ashley",
          path: "missing.ts",
        },
        dispatcher: {
          dispatch: async () => mockResult,
        } as any,
        envOverrides: {
          sandboxEngineeringLifecycleEnabled: true,
        },
      });

      expect(res.license.state).toBe("failed");
      expect(res.license.error).toBe("not_found");
      expect(res.license.cancellationRequested).toBe(true);
      expect(res.license.cancellationAcknowledged).toBe(false);
      expect(res.observation).toBeNull();
    });
  });

  describe("v2-license-audit for project_investigation", () => {
    it("formats project_investigation audit record with metadata only and zero code content", () => {
      const audit = formatSandboxV2LicenseAudit(
        {
          state: "succeeded",
          profile: "project_investigation",
          taskId: "v2-insp-12345",
          sourceMessageEntityUuid: "msg-uuid-1",
        },
        {
          projectId: "project-ashley",
          operation: "project.read_file",
          path: "apps/agent-service/src/index.ts",
          verified: true,
          truncated: false,
          executedAtMs: 12345,
          contentUtf8: "TOP_SECRET_CODE();",
          bytes: 18,
          sha256: "sha256-abc",
        },
      );

      expect(audit).not.toBeNull();
      expect(audit?.discriminator).toBe("ASHLEY_SANDBOX_V2_LICENSE");
      expect(audit?.profile).toBe("project_investigation");
      expect(audit?.verified).toBe(true);
      expect(audit?.inspection).toEqual({
        operation: "project.read_file",
        projectId: "project-ashley",
        targetPath: "apps/agent-service/src/index.ts",
        targetPattern: undefined,
        truncated: false,
        bytes: 18,
        filesScanned: undefined,
        matchCount: undefined,
        entryCount: undefined,
      });

      const serialized = JSON.stringify(audit);
      expect(serialized).not.toContain("TOP_SECRET_CODE");
    });
  });

  describe("M1 Preservation", () => {
    it("force-closes M1 cleanup before settlement so Expression keeps its reserve", async () => {
      let nowMs = 1_000;
      let forcedClosures = 0;
      const license = await executeReactiveSandboxTaskV2({
        childExecutionDeadlineAtMs: 1_300,
        settlementDeadlineAtMs: 1_500,
        clock: { nowMs: () => nowMs },
        executor: async () => {
          nowMs = 1_290;
          return {
            version: 1,
            kind: "file.roundtrip",
            ok: true,
            checks: {
              roundtrip: true,
              deleted: true,
              absent: true,
              homeAbsent: true,
              runAbsent: true,
              hostSentinelAbsent: true,
              envClean: true,
              loopbackIsolated: true,
              externalIsolated: true,
              fdClean: true,
            },
          };
        },
        serverCloser: ((server: import("node:net").Server, connections: Set<import("node:net").Socket>) => {
          forcedClosures += 1;
          server.close();
          for (const socket of connections) socket.destroy();
          connections.clear();
          nowMs = 1_490;
        }),
      } as any);

      expect(license.state).toBe("succeeded");
      expect(forcedClosures).toBe(1);
      expect(nowMs).toBeLessThanOrEqual(1_500);
      expect(1_700 - nowMs).toBe(210);
    });

    it("derives the M1 child timeout from the selected branch and preserves settlement reserve", async () => {
      let nowMs = 1_000;
      let receivedTimeoutMs = -1;
      let receivedTerminationDeadlineAtMs = -1;
      const license = await executeReactiveSandboxTaskV2({
        childExecutionDeadlineAtMs: 1_300,
        childTerminationDeadlineAtMs: 1_400,
        settlementDeadlineAtMs: 1_500,
        clock: { nowMs: () => nowMs },
        executor: async (_request, _evidence, options) => {
          receivedTimeoutMs = options?.timeoutMs ?? -1;
          receivedTerminationDeadlineAtMs =
            options?.childTerminationDeadlineAtMs ?? -1;
          nowMs = 1_400;
          return {
            version: 1,
            kind: "file.roundtrip",
            ok: true,
            checks: {
              roundtrip: true,
              deleted: true,
              absent: true,
              homeAbsent: true,
              runAbsent: true,
              hostSentinelAbsent: true,
              envClean: true,
              loopbackIsolated: true,
              externalIsolated: true,
              fdClean: true,
            },
          };
        },
      });

      expect(receivedTimeoutMs).toBe(300);
      expect(receivedTerminationDeadlineAtMs).toBe(1_400);
      expect(license.state).toBe("succeeded");
    });

    it("preserves unacknowledged M1 cancellation truth", async () => {
      const license = await executeReactiveSandboxTaskV2({
        childExecutionDeadlineAtMs: 1_300,
        childTerminationDeadlineAtMs: 1_400,
        settlementDeadlineAtMs: 1_500,
        clock: { nowMs: () => 1_000 },
        executor: async () => ({
          version: 1,
          kind: "file.roundtrip",
          ok: false,
          code: "timeout",
          cancellationRequested: true,
          cancellationAcknowledged: false,
        }),
      });

      expect(license).toMatchObject({
        state: "failed",
        error: "timeout",
        cancellationRequested: true,
        cancellationAcknowledged: false,
      });
    });

    it("does not return M1 success after cleanup crosses its settlement boundary", async () => {
      let nowMs = 2_000;
      const license = await executeReactiveSandboxTaskV2({
        childExecutionDeadlineAtMs: 2_300,
        settlementDeadlineAtMs: 2_500,
        clock: { nowMs: () => nowMs },
        executor: async () => {
          nowMs = 2_510;
          return {
            version: 1,
            kind: "file.roundtrip",
            ok: true,
            checks: {
              roundtrip: true,
              deleted: true,
              absent: true,
              homeAbsent: true,
              runAbsent: true,
              hostSentinelAbsent: true,
              envClean: true,
              loopbackIsolated: true,
              externalIsolated: true,
              fdClean: true,
            },
          };
        },
      });

      expect(license).toMatchObject({
        state: "failed",
        error: "acquisition_settlement_deadline_expired",
      });
    });

    it("preserves M1 file.roundtrip execution path", async () => {
      const mockM1Executor = async () => ({
        version: 1 as const,
        kind: "file.roundtrip" as const,
        ok: true as const,
        checks: {
          roundtrip: true,
          deleted: true,
          absent: true,
          homeAbsent: true,
          runAbsent: true,
          hostSentinelAbsent: true,
          envClean: true,
          loopbackIsolated: true,
          externalIsolated: true,
          fdClean: true,
        },
      });

      const license = await executeReactiveSandboxTaskV2({
        executor: mockM1Executor,
      });

      expect(license.state).toBe("succeeded");
      expect(license.profile).toBe("sandbox_workspace_file_roundtrip");
      expect(license.effectEvidence).toBeDefined();
    });
  });

  describe("executeWorkspaceExperimentV2 & Candidate Workspace", () => {
    it("evaluates canOfferCandidateWorkspace requiring project_experimentation and candidateWorkspaceAllowed", () => {
      const path = join(tmpdir(), `ashley-ws-gate-${Date.now()}.db`);
      const db = openNuclearDb(new DatabaseSync(path), {
        continuity: openContinuityDb(new DatabaseSync(":memory:")),
      });
      const regAllowed = new V2ProjectReadRegistry([
        {
          projectId: "project-ashley",
          canonicalRoot: "/home/xarvak/project-ashley",
          displayName: "Ashley",
          enabled: true,
          readAllowed: true,
          candidateWorkspaceAllowed: true,
          engineeringAllowed: false,
        },
      ]);
      const regDisallowed = new V2ProjectReadRegistry([
        {
          projectId: "project-ashley",
          canonicalRoot: "/home/xarvak/project-ashley",
          displayName: "Ashley",
          enabled: true,
          readAllowed: true,
          candidateWorkspaceAllowed: false,
          engineeringAllowed: false,
        },
      ]);

      // Initially project_experimentation capability is observe -> canOfferCandidateWorkspace is false
      expect(
        canOfferCandidateWorkspace(db, {
          registry: regAllowed,
          masterMode: "apply",
          substrateAvailable: true,
          lifecycleEnabled: true,
        }),
      ).toBe(false);

      // When candidateWorkspaceAllowed is false on registry, even if capability is promoted -> false
      expect(
        canOfferCandidateWorkspace(db, {
          registry: regDisallowed,
          masterMode: "apply",
          substrateAvailable: true,
          lifecycleEnabled: true,
        }),
      ).toBe(false);

      db.close();
      try { rmSync(path, { force: true }); } catch {}
    });

    it("executes candidate workspace operation and produces safe WorkspaceClaimEffect facts", async () => {
      const reg = new V2ProjectReadRegistry([
        {
          projectId: "project-ashley",
          canonicalRoot: "/home/xarvak/project-ashley",
          displayName: "Ashley",
          enabled: true,
          readAllowed: true,
          candidateWorkspaceAllowed: true,
          engineeringAllowed: false,
        },
      ]);

      const mockDispatcher = {
        dispatch: async (req: SandboxV2Request): Promise<SandboxV2Result> => {
          expect(req.operation).toBe("workspace.write_file");
          return {
            outcome: "succeeded",
            operation: "workspace.write_file",
            workspaceId: "ws-mock-42",
            sourceSnapshotId: "snap_mock_99",
            result: {
              kind: "workspace.write_file",
              path: "witness.txt",
              bytesWritten: 12,
              contentHash: "f".repeat(64),
              readMatches: true,
              deleted: false,
              verifiedAbsent: false,
              completedAtMs: Date.now(),
            },
            executedAtMs: Date.now(),
          };
        },
      } as any;

      const result = await executeWorkspaceExperimentV2({
        request: {
          version: 2,
          operation: "workspace.write_file",
          projectId: "project-ashley",
          path: "witness.txt",
          content: "witness-data",
          mustNotExist: true,
        },
        dispatcher: mockDispatcher,
        registry: reg,
        skipCapabilityGate: true,
        envOverrides: {
          sandboxEngineeringLifecycleEnabled: true,
        },
      });

      expect(result.license.state).toBe("succeeded");
      expect(result.license.profile).toBe("project_experimentation");
      expect(result.license.workspaceClaimEffect).toBeDefined();

      const effect = result.license.workspaceClaimEffect!;
      expect(effect.verified).toBe(true);
      expect(effect.projectId).toBe("project-ashley");
      expect(effect.workspaceId).toBe("ws-mock-42");
      expect(effect.operation).toBe("workspace.write_file");
      expect(effect.logicalRelativePath).toBe("witness.txt");
      expect(effect.sourceSnapshotId).toBe("snap_mock_99");
      expect(effect.bytesWritten).toBe(12);

      // Safe facts verification: NO raw contents or host filesystem roots in license
      const rawLicense = JSON.stringify(result.license);
      expect(rawLicense).not.toContain("witness-data");
      expect(rawLicense).not.toContain("/home/xarvak");

      expect(result.observation).toBeDefined();
      expect(result.observation?.workspaceId).toBe("ws-mock-42");
      expect(result.observation?.operation).toBe("workspace.write_file");
      expect(result.observation?.verified).toBe(true);
    });

    it("maps an indeterminate post-dispatch outcome to outcome_unknown without redispatch", async () => {
      const reg = new V2ProjectReadRegistry([
        {
          projectId: "project-ashley",
          canonicalRoot: "/home/xarvak/project-ashley",
          displayName: "Ashley",
          enabled: true,
          readAllowed: true,
          candidateWorkspaceAllowed: true,
          engineeringAllowed: false,
        },
      ]);
      let dispatches = 0;
      const result = await executeWorkspaceExperimentV2({
        request: {
          version: 2,
          operation: "workspace.write_file",
          projectId: "project-ashley",
          path: "witness.txt",
          content: "witness-data",
          mustNotExist: true,
        },
        dispatcher: {
          dispatch: async (): Promise<SandboxV2Result> => {
            dispatches += 1;
            return {
              outcome: "failed",
              operation: "workspace.write_file",
              error: "timeout",
              executionTruth: "effect_indeterminate",
              cancellationRequested: true,
              cancellationAcknowledged: false,
              executedAtMs: Date.now(),
            };
          },
        } as unknown as SandboxV2Dispatcher,
        registry: reg,
        skipCapabilityGate: true,
        envOverrides: {
          sandboxEngineeringLifecycleEnabled: true,
        },
      });

      expect(dispatches).toBe(1);
      expect(result.observation).toBeNull();
      expect(result.license).toMatchObject({
        state: "outcome_unknown",
        executionTruth: "effect_indeterminate",
        error: "timeout",
        cancellationRequested: true,
        cancellationAcknowledged: false,
      });
    });

    it("fails closed when project is not allowed for candidate workspaces", async () => {
      const reg = new V2ProjectReadRegistry([
        {
          projectId: "project-ashley",
          canonicalRoot: "/home/xarvak/project-ashley",
          displayName: "Ashley",
          enabled: true,
          readAllowed: true,
          candidateWorkspaceAllowed: false,
          engineeringAllowed: false,
        },
      ]);

      const result = await executeWorkspaceExperimentV2({
        request: {
          version: 2,
          operation: "workspace.read_file",
          projectId: "project-ashley",
          path: "README.md",
        },
        registry: reg,
        skipCapabilityGate: true,
        envOverrides: {
          sandboxAvailable: () => true,
          sandboxEngineeringLifecycleEnabled: true,
        },
      });

      expect(result.license.state).toBe("failed");
      expect(result.license.error).toBe("workspace_not_allowed");
      expect(result.observation).toBeNull();
    });
  });
});
