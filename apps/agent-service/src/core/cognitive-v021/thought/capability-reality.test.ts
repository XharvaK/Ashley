import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { V2ProjectReadRegistry } from "@composer-assistant/sandbox-v2";
import { openNuclearDb } from "../../db.js";
import { listCapabilityStatuses } from "../../rollout/capabilities.js";
import { getCapabilityReality } from "./capability-reality.js";

function activeDb(): DatabaseSync {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  listCapabilityStatuses(db, "apply");
  db.prepare("UPDATE capability_releases SET state = 'active'").run();
  return db;
}

function registry(): V2ProjectReadRegistry {
  return new V2ProjectReadRegistry([{
    projectId: "project-ashley",
    canonicalRoot: "/srv/projects/project-ashley",
    displayName: "Project Ashley",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: true,
    engineeringAllowed: false,
    verificationAllowed: true,
    allowedRecipeIds: ["recipe-1"],
    authorshipAllowed: true,
    operationAllowed: true,
    patchExportAllowed: true,
    exportDestinationCanonicalRoot: "/srv/review/project-ashley",
  }]);
}

describe("v0.2.1 CapabilityReality live-surface contract", () => {
  it("does not advertise unsupported effects or perception from active legacy rows", () => {
    const db = activeDb();
    try {
      const reality = getCapabilityReality(db, {
        registry: registry(),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
      } as Parameters<typeof getCapabilityReality>[1]);

      expect(reality).toMatchObject({
        canOfferBoundedOperation: false,
        canOfferPatchExport: true,
        vision: false,
        attachmentText: false,
        conversationalRead: false,
        webSearch: false,
      });
    } finally {
      db.close();
    }
  });

  it("advertises accepted Sandbox V2 faculties only when capability and substrate gates pass", () => {
    const db = activeDb();
    try {
      const reality = getCapabilityReality(db, {
        registry: registry(),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
      } as Parameters<typeof getCapabilityReality>[1]);

      expect(reality).toMatchObject({
        canOfferProjectInspection: true,
        canOfferWorkspace: true,
        canOfferVerification: true,
        canOfferAuthorship: true,
        canOfferInquiry: true,
      });
      expect(reality.operationCapabilities).toEqual([
        {
          operationKind: "project.read_file",
          semanticClass: "observation",
          family: "project_inspection",
          readOnly: true,
          requiresProject: true,
          available: true,
          requiredRequestFields: ["projectId", "path"],
          optionalRequestFields: [],
          operatorBoundRequestFields: [],
          authorizedProjectIds: ["project-ashley"],
        },
        {
          operationKind: "project.list_directory",
          semanticClass: "observation",
          family: "project_inspection",
          readOnly: true,
          requiresProject: true,
          available: true,
          requiredRequestFields: ["projectId", "path"],
          optionalRequestFields: [],
          operatorBoundRequestFields: [],
          authorizedProjectIds: ["project-ashley"],
        },
        {
          operationKind: "project.search_text",
          semanticClass: "observation",
          family: "project_inspection",
          readOnly: true,
          requiresProject: true,
          available: true,
          requiredRequestFields: ["projectId", "pattern"],
          optionalRequestFields: ["path", "maxMatches"],
          operatorBoundRequestFields: [],
          authorizedProjectIds: ["project-ashley"],
        },
        {
          operationKind: "workspace.verify",
          semanticClass: "effect",
          family: "project_verification",
          readOnly: true,
          requiresProject: true,
          available: true,
          requiredRequestFields: ["projectId"],
          optionalRequestFields: ["workspaceId", "recipeId"],
          operatorBoundRequestFields: ["workspaceId", "recipeId"],
          authorizedProjectIds: ["project-ashley"],
        },
        {
          operationKind: "patch_export",
          semanticClass: "effect",
          family: "patch_export",
          readOnly: false,
          requiresProject: true,
          available: true,
          requiredRequestFields: ["projectId", "changesetId", "adjudication"],
          optionalRequestFields: [],
          operatorBoundRequestFields: ["changesetId"],
          authorizedProjectIds: ["project-ashley"],
        },
      ]);
      expect(reality.operationCapabilities?.some((operation) =>
        "expectedKind" in operation || "semanticBranch" in operation,
      )).toBe(false);
    } finally {
      db.close();
    }
  });

  it("does not offer inquiry when the lifecycle gate is false", () => {
    const db = activeDb();
    try {
      const reality = getCapabilityReality(db, {
        registry: registry(),
        masterMode: "apply",
        lifecycleEnabled: false,
        substrateAvailable: true,
      });

      expect(reality).toMatchObject({
        canOfferWorkspace: false,
        canOfferVerification: false,
        canOfferInquiry: false,
      });
      expect(reality.reachability?.reasons).toMatchObject({
        canOfferInquiry: "substrate_without_authority",
      });
    } finally {
      db.close();
    }
  });

  it("projects reason-coded reachability for Owner and room audiences", () => {
    const db = activeDb();
    try {
      const owner = getCapabilityReality(db, {
        registry: registry(),
        audience: { kind: "owner_private" },
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
      });
      expect(owner.reachability?.reasons).toMatchObject({
        canOfferProjectInspection: "capability_exists",
        canOfferWorkspace: "capability_exists",
        canOfferPatchExport: "capability_exists",
        vision: "evidence_not_acquired",
        canOfferBoundedOperation: "unavailable",
      });

      const room = getCapabilityReality(db, {
        registry: registry(),
        audience: { kind: "room", roomId: "room:guild-1:channel-1" },
        licenses: [],
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
      });
      expect(room.reachability?.reasons).toMatchObject({
        canOfferProjectInspection: "another_audience_only",
        canOfferWorkspace: "another_audience_only",
        canOfferVerification: "another_audience_only",
        canOfferInquiry: "another_audience_only",
        canOfferPatchExport: "another_audience_only",
      });
      expect(room.operationCapabilities?.every((operation) =>
        operation.authorizedProjectIds.length === 0 && operation.available === false,
      )).toBe(true);
    } finally {
      db.close();
    }
  });

  it("keeps M6 dark and L1-direct independent of OpenCode quota", () => {
    const db = activeDb();
    try {
      const reality = getCapabilityReality(db, {
        registry: registry(),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
        opencodeWorkerEnabled: true,
        opencodeQuotaStatePath: "this-path-does-not-exist.json",
      } as Parameters<typeof getCapabilityReality>[1]);
      expect(reality.canOfferBoundedOperation).toBe(false);
      expect(reality.canOfferProjectInspection).toBe(true);
      expect(reality.canOfferDelegatedInvestigation).toBe(true);
      expect(reality.operationCapabilities?.some((operation) => operation.operationKind === "project.investigate")).toBe(true);
      expect(JSON.stringify(reality)).not.toMatch(/NVIDIA_FREE|OTHER_FREE|Nemotron|Muse/);
    } finally {
      db.close();
    }
  });
});
