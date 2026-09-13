import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../types.js";
import { getCognitiveHealthSnapshot } from "./health.js";

describe("cognitive health projection", () => {
  it("reports the kernel and schema while reducing the sidecar path to its basename", () => {
    const sidecar = openTestSidecar();
    const health = getCognitiveHealthSnapshot({
      mode: "v021",
      sidecar,
      sidecarPath: "C:/Users/doc/.composer-assistant/cognitive-v021.db",
    });
    expect(health).toEqual({
      cognitiveKernel: "v021",
      cognitiveSidecar: { open: true, schemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION, path: "cognitive-v021.db" },
      cognitiveSidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION,
      cognitiveSidecarPath: "cognitive-v021.db",
    });
    expect(JSON.stringify(health)).not.toContain(".composer-assistant");
    sidecar.close();
  });

  it("does not claim an unopened sidecar", () => {
    expect(getCognitiveHealthSnapshot({ mode: "v021" })).toMatchObject({
      cognitiveKernel: "v021",
      cognitiveSidecar: { open: false, schemaVersion: null, path: null },
      cognitiveSidecarSchemaVersion: null,
      cognitiveSidecarPath: null,
    });
  });
});
