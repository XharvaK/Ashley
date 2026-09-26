import { describe, expect, it } from "vitest";
import {
  assertArtifactCursorBinding,
  canonicalObservationView,
  projectFileArtifactIdentity,
  webPageArtifactIdentity,
  type ArtifactCursor,
} from "./view.js";

describe("W1-P4 artifact identity and observation view", () => {
  it("reuses a project-file artifact identity for one capture but separates locators", () => {
    const capture = {
      projectId: "project-ashley",
      path: "README.md",
      rawByteHash: "a".repeat(64),
      capturedAtMs: 42,
    };

    const first = projectFileArtifactIdentity(capture);
    const sameCapture = projectFileArtifactIdentity(capture);
    const otherSource = projectFileArtifactIdentity({ ...capture, path: "docs/README.md" });

    expect(sameCapture).toEqual(first);
    expect(first.parentArtifactId).toMatch(/^artifact:v1:[0-9a-f]{64}$/);
    expect(first.representationId).toMatch(/^representation:v1:[0-9a-f]{64}$/);
    expect(otherSource.parentArtifactId).not.toBe(first.parentArtifactId);
  });

  it("versions a public page by cleaned content and capture time", () => {
    const first = webPageArtifactIdentity({
      requestedUrl: "https://public.test/page",
      contentHash: "a".repeat(64),
      capturedAtMs: 42,
    });
    const same = webPageArtifactIdentity({
      requestedUrl: "https://public.test/page",
      contentHash: "a".repeat(64),
      capturedAtMs: 42,
    });
    const next = webPageArtifactIdentity({
      requestedUrl: "https://public.test/page",
      contentHash: "b".repeat(64),
      capturedAtMs: 43,
    });

    expect(same).toEqual(first);
    expect(next.parentArtifactId).not.toBe(first.parentArtifactId);
  });

  it("rejects a cursor when the bound artifact hash has changed", () => {
    const binding = {
      artifactId: "artifact:one",
      artifactHash: "a".repeat(64),
      representationId: "representation:one",
      selector: { kind: "text_window", start: 0 },
      audience: { kind: "owner_private" } as const,
    };
    const cursor: ArtifactCursor = {
      schema: "ashley.artifact_cursor.v1",
      ...binding,
      continuation: { offset: 128 },
    };

    expect(() => assertArtifactCursorBinding(cursor, binding)).not.toThrow();
    expect(() => assertArtifactCursorBinding({ ...cursor, artifactHash: "b".repeat(64) }, binding))
      .toThrow("artifact_cursor_artifact_hash_mismatch");
  });

  it("retains a non-empty derivation for derived result views", () => {
    expect(canonicalObservationView({
      parentArtifactId: "artifact:result-set",
      representationId: "representation:result-set",
      derivation: "search_snippet",
    })).toMatchObject({ derivation: "search_snippet" });
    expect(() => canonicalObservationView({ derivation: " " }))
      .toThrow("observation_view_invalid");
  });
});
