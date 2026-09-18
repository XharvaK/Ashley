import { describe, expect, it } from "vitest";
import {
  directProjectInspectionRequest,
  isExactDirectProjectInspectionRequest,
  routeProjectInspectionRequest,
  workerProjectInspectionRequest,
} from "./project-inspection-route.js";

describe("project.inspect Host routing", () => {
  it("routes one exact file retrieval to the direct V2 primitive", () => {
    const request = { projectId: "project-ashley", locator: { kind: "file", path: "README.md" } };
    expect(isExactDirectProjectInspectionRequest(request)).toBe(true);
    expect(routeProjectInspectionRequest(request)).toBe("direct");
    expect(directProjectInspectionRequest(request)).toEqual({
      operation: "project.read_file",
      projectId: "project-ashley",
      path: "README.md",
    });
  });

  it("routes one exact directory enumeration to the direct V2 primitive", () => {
    const request = { projectId: "project-ashley", locator: { kind: "directory", path: "apps/agent-service" } };
    expect(routeProjectInspectionRequest(request)).toBe("direct");
    expect(directProjectInspectionRequest(request)).toEqual({
      operation: "project.list_directory",
      projectId: "project-ashley",
      path: "apps/agent-service",
    });
  });

  it("routes one exact bounded search to the direct V2 primitive", () => {
    const request = {
      projectId: "project-ashley",
      locator: { kind: "search", pattern: "runLiveCognitiveTurn", path: "apps", maxMatches: 4 },
    };
    expect(routeProjectInspectionRequest(request)).toBe("direct");
    expect(directProjectInspectionRequest(request)).toEqual({
      operation: "project.search_text",
      projectId: "project-ashley",
      pattern: "runLiveCognitiveTurn",
      path: "apps",
      maxMatches: 4,
    });
  });

  it.each([
    {
      name: "known file plus an analysis question",
      request: { projectId: "project-ashley", locator: { kind: "file", path: "README.md" }, question: "Explain why this works" },
    },
    {
      name: "multi-file evidence",
      request: { projectId: "project-ashley", focus: "compare the router and worker adapter" },
    },
    {
      name: "diagnosis",
      request: { projectId: "project-ashley", question: "Trace the failure and diagnose its cause" },
    },
    {
      name: "uncertain scope",
      request: { projectId: "project-ashley" },
    },
    {
      name: "host route field",
      request: { projectId: "project-ashley", locator: { kind: "file", path: "README.md" }, worker: true },
    },
  ])("routes $name to the worker", ({ request }) => {
    expect(isExactDirectProjectInspectionRequest(request)).toBe(false);
    expect(routeProjectInspectionRequest(request)).toBe("worker");
    expect(directProjectInspectionRequest(request)).toBeNull();
  });

  it("translates worker requests at the Host boundary without route or model fields", () => {
    expect(workerProjectInspectionRequest({
      projectId: "project-ashley",
      locator: { kind: "file", path: "README.md" },
      question: "Why is this file relevant?",
      provider: "forbidden-to-thought",
    })).toEqual({
      projectId: "project-ashley",
      focus: "Why is this file relevant?",
      maxSteps: 8,
    });
  });
});
