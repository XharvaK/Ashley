import { DatabaseSync } from "node:sqlite";
import { importLegacySemanticState, LegacyImportError } from "../../apps/agent-service/dist/core/cognitive-v021/migration/import-legacy.js";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const nuclearPath = argument("--nuclear");
const continuityPath = argument("--continuity");
const sidecarPath = argument("--sidecar");
const mode = argument("--mode");

if (!nuclearPath || !continuityPath || !sidecarPath || !["dry-run", "apply", "verify"].includes(mode)) {
  console.error("USAGE: node scripts/cognitive-v021/import-legacy-semantic-state.mjs --nuclear <path> --continuity <path> --sidecar <path> --mode dry-run|apply|verify");
  process.exitCode = 2;
} else {
  let nuclear;
  let continuity;
  let sidecar;
  try {
    nuclear = new DatabaseSync(nuclearPath, { readOnly: true });
    continuity = new DatabaseSync(continuityPath, { readOnly: true });
    sidecar = new DatabaseSync(sidecarPath, { readOnly: mode !== "apply" });
    const report = importLegacySemanticState({
      nuclear,
      continuity,
      sidecar,
      mode,
      nuclearPath,
      continuityPath,
      sidecarPath,
    });
    console.log(JSON.stringify(report));
  } catch (error) {
    const code = error instanceof LegacyImportError ? error.code : "INPUT_UNREADABLE";
    console.error(JSON.stringify({ code, message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  } finally {
    nuclear?.close();
    continuity?.close();
    sidecar?.close();
  }
}
