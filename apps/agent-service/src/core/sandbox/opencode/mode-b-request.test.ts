import { describe, expect, it } from "vitest";
import { MODE_B_HOST_MAX_STEPS } from "./catalog.js";
import { validateModeBRequest } from "./mode-b-request.js";

describe("Mode-B request contract", () => {
  it("accepts the typed Thought fields and tightens maxSteps to the Host ceiling", () => {
    expect(validateModeBRequest({
      kind: "project.investigate",
      request: { projectId: "project-ashley", focus: "apps/agent-service", maxSteps: 99_999 },
    })).toEqual({
      ok: true,
      value: {
        kind: "project.investigate",
        projectId: "project-ashley",
        focus: "apps/agent-service",
        maxSteps: MODE_B_HOST_MAX_STEPS,
      },
    });
  });

  it("rejects model, pool, provider, argv, env, network, and host paths", () => {
    for (const field of ["model", "pool", "provider", "argv", "env", "network", "canonicalRoot"]) {
      const result = validateModeBRequest({
        kind: "project.investigate",
        request: { projectId: "project-ashley", [field]: "x" },
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(["forbidden_field", "unknown_field"]).toContain(result.error);
      expect(result.field).toBe(field);
    }
    expect(validateModeBRequest({
      kind: "candidate.develop",
      request: { projectId: "project-ashley", focus: "/etc/passwd" },
    })).toMatchObject({ ok: false, error: "invalid_focus" });
  });

  it("does not overload project.inspect", () => {
    expect(validateModeBRequest({
      kind: "project.investigate",
      request: { projectId: "project-ashley" },
    })).toMatchObject({
      ok: true,
      value: { kind: "project.investigate", projectId: "project-ashley", maxSteps: MODE_B_HOST_MAX_STEPS },
    });
    expect(validateModeBRequest({
      kind: "project.inspect",
      request: { projectId: "project-ashley" },
    })).toMatchObject({ ok: false, error: "wrong_kind" });
  });

  it("owns absence, clamp, and rejection at the X-layer boundary (O-H12a/SD11)", () => {
    expect(MODE_B_HOST_MAX_STEPS).toBe(128);
    expect(validateModeBRequest({
      kind: "project.investigate",
      request: { projectId: "project-ashley", maxSteps: 3 },
    })).toMatchObject({ ok: true, value: { maxSteps: 3 } });
    expect(validateModeBRequest({
      kind: "project.investigate",
      request: { projectId: "project-ashley" },
    })).toMatchObject({ ok: true, value: { maxSteps: MODE_B_HOST_MAX_STEPS } });
    for (const maxSteps of [0, -4, 2.5, "8"]) {
      expect(validateModeBRequest({
        kind: "project.investigate",
        request: { projectId: "project-ashley", maxSteps },
      })).toMatchObject({ ok: false, error: "invalid_max_steps" });
    }
    expect(validateModeBRequest({
      kind: "project.investigate",
      request: { projectId: "project-ashley", locator: { kind: "file", path: "README.md" } },
    })).toMatchObject({ ok: false, error: "unknown_field" });
  });
});
