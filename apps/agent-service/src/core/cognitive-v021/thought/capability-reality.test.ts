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
        canOfferPatchExport: false,
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
      ]);
      expect(reality.operationCapabilities?.some((operation) =>
        "expectedKind" in operation || "semanticBranch" in operation,
      )).toBe(false);
    } finally {
      db.close();
    }
  });
});
