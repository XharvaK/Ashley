import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateSyntheticIncidentC } from "./snapshot-incident-c.mjs";

console.log("Fetching Incident C snapshot from Mint via read-only SSH...");
const snapshotSource = readFileSync(join(process.cwd(), "scripts", "snapshot-incident-c.mjs"), "utf8");

const runnerScript = `
${snapshotSource}

const targetDb = join(homedir(), ".composer-assistant", "cognitive-v021.db");
const snap = extractIncidentCSnapshot(targetDb);
console.log("SNAPSHOT_JSON_START");
console.log(JSON.stringify(snap));
console.log("SNAPSHOT_JSON_END");
`;

const stdout = execSync('ssh mint "node --input-type=module"', {
  input: runnerScript,
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
});

const startIdx = stdout.indexOf("SNAPSHOT_JSON_START");
const endIdx = stdout.indexOf("SNAPSHOT_JSON_END");
if (startIdx === -1 || endIdx === -1) {
  throw new Error("Could not find snapshot JSON delimiters in output");
}

const jsonStr = stdout.substring(startIdx + "SNAPSHOT_JSON_START".length, endIdx).trim();
const snapshot = JSON.parse(jsonStr);

console.log(`Snapshot received: ${snapshot.matchedCount} matched items out of ${snapshot.totalSidecarAssertions} total assertions.`);

// Write private Level 1 snapshot (gitignored under docs/cognitive-rework/v0.2.1/artifacts/runtime/*)
const runtimeDir = join(process.cwd(), "docs", "cognitive-rework", "v0.2.1", "artifacts", "runtime");
if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
writeFileSync(join(runtimeDir, "incident-c-exact-snapshot.json"), JSON.stringify(snapshot, null, 2), "utf8");
console.log(`Wrote ${join(runtimeDir, "incident-c-exact-snapshot.json")}`);

// Generate Level 2 synthetic fixtures
const synth = generateSyntheticIncidentC(snapshot);
const fixturesDir = join(process.cwd(), "apps", "agent-service", "src", "core", "cognitive-v021", "retrieval", "fixtures");
if (!existsSync(fixturesDir)) mkdirSync(fixturesDir, { recursive: true });

writeFileSync(join(fixturesDir, "incident-c-synthetic.json"), JSON.stringify(synth.items, null, 2), "utf8");
writeFileSync(join(fixturesDir, "incident-c-labels.json"), JSON.stringify(synth.labels, null, 2), "utf8");
writeFileSync(join(fixturesDir, "synthetic-fidelity.json"), JSON.stringify(synth.fidelity, null, 2), "utf8");

console.log(`Wrote synthetic fixtures to ${fixturesDir}`);
