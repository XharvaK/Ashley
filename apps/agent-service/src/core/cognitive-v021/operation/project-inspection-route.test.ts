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
});

describe("workerProjectInspectionRequest ownership boundary (O-H12a/SD11)", () => {
  it("omits maxSteps entirely when Thought authored none", () => {
    const translated = workerProjectInspectionRequest({ projectId: "project-ashley" });
    expect(translated).toEqual({ projectId: "project-ashley" });
    expect(translated).not.toHaveProperty("maxSteps");
  });

  it.each([3, 8, 99])("transports authored maxSteps %i verbatim at this layer", (maxSteps) => {
    expect(workerProjectInspectionRequest({ projectId: "project-ashley", maxSteps }))
      .toEqual({ projectId: "project-ashley", maxSteps });
  });

  it.each([0, -4, 2.5, "8"])(
    "does not reinterpret a present maxSteps %p into absence or a default",
    (maxSteps) => {
      const translated = workerProjectInspectionRequest({ projectId: "project-ashley", maxSteps });
      expect(translated).toHaveProperty("maxSteps", maxSteps);
    },
  );

  it("preserves authored focus verbatim", () => {
    expect(workerProjectInspectionRequest({
      projectId: "project-ashley",
      focus: "compare the router and worker adapter",
    })).toEqual({
      projectId: "project-ashley",
      focus: "compare the router and worker adapter",
    });
  });

  it("transports an authored question verbatim as worker focus", () => {
    expect(workerProjectInspectionRequest({
      projectId: "project-ashley",
      question: "Why is this file relevant?",
    })).toEqual({
      projectId: "project-ashley",
      focus: "Why is this file relevant?",
    });
  });

  it("prefers authored focus over an authored question", () => {
    expect(workerProjectInspectionRequest({
      projectId: "project-ashley",
      focus: "authored focus",
      question: "authored question",
    })).toEqual({
      projectId: "project-ashley",
      focus: "authored focus",
    });
  });

  it("never synthesizes locator prose when no focus or question is authored", () => {
    const translated = workerProjectInspectionRequest({
      projectId: "project-ashley",
      locator: { kind: "file", path: "README.md" },
    });
    expect(translated).toEqual({ projectId: "project-ashley" });
    expect(JSON.stringify(translated)).not.toContain("inspect locator");
  });

  it("drops locator structure without prose even when extra context forces the worker route", () => {
    const translated = workerProjectInspectionRequest({
      projectId: "project-ashley",
      locator: { kind: "file", path: "README.md" },
      question: "Why is this file relevant?",
      provider: "forbidden-to-thought",
    });
    expect(translated).toEqual({
      projectId: "project-ashley",
      focus: "Why is this file relevant?",
    });
    expect(JSON.stringify(translated)).not.toContain("inspect locator");
  });

  it("returns null without a usable projectId", () => {
    expect(workerProjectInspectionRequest({})).toBeNull();
    expect(workerProjectInspectionRequest({ projectId: "   " })).toBeNull();
  });
});
