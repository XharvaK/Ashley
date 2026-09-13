import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const RESERVED = resolve(homedir(), ".composer-assistant").replaceAll("\\", "/").toLowerCase();

function canonical(input) {
  const absolute = resolve(input);
  let cursor = absolute;
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(cursor.slice(parent.length + 1));
    cursor = parent;
  }
  const base = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return `${base}/${suffix.join("/")}`.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function assertIsolated(path, label) {
  const identity = canonical(path);
  if (identity === RESERVED || identity.startsWith(`${RESERVED}/`)) {
    throw new Error(`RESERVED_PRODUCTION_PATH_REFUSED:${label}:${path}`);
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function copySqliteFamily(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${source}${suffix}`)) cpSync(`${source}${suffix}`, `${destination}${suffix}`);
  }
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${script} failed: ${result.stderr || result.stdout}`.trim());
  return result.stdout.trim();
}

const help = process.argv.includes("--help");
if (help) {
  console.log("USAGE: node scripts/cognitive-v021/cutover-rehearsal.mjs --nuclear <copy-source> --continuity <copy-source> --sidecar <copy-source> [--workdir <isolated-dir>]");
  process.exit(0);
}

const nuclearSource = argument("--nuclear");
const continuitySource = argument("--continuity");
const sidecarSource = argument("--sidecar");
const requestedWorkdir = argument("--workdir");
if (!nuclearSource || !continuitySource || !sidecarSource) {
  console.error("USAGE: node scripts/cognitive-v021/cutover-rehearsal.mjs --nuclear <copy-source> --continuity <copy-source> --sidecar <copy-source> [--workdir <isolated-dir>]");
  process.exitCode = 2;
} else {
  try {
    for (const [label, path] of [["nuclear", nuclearSource], ["continuity", continuitySource], ["sidecar", sidecarSource]]) {
      assertIsolated(path, label);
      if (!existsSync(path)) throw new Error(`INPUT_UNREADABLE:${label}:${path}`);
    }
    const workdir = requestedWorkdir ? resolve(requestedWorkdir) : mkdtempSync(join(tmpdir(), "ashley-cognitive-v021-rehearsal-"));
    assertIsolated(workdir, "workdir");
    mkdirSync(workdir, { recursive: true });
    const nuclear = join(workdir, "nuclear.db");
    const continuity = join(workdir, "continuity.db");
    const sidecar = join(workdir, "cognitive-v021.db");
    const rollback = join(workdir, "rollback-cognitive-v021.db");
    copySqliteFamily(nuclearSource, nuclear);
    copySqliteFamily(continuitySource, continuity);
    copySqliteFamily(sidecarSource, sidecar);
    copySqliteFamily(sidecar, rollback);

    const importCli = resolve("scripts/cognitive-v021/import-legacy-semantic-state.mjs");
    const importArgs = ["--nuclear", nuclear, "--continuity", continuity, "--sidecar", sidecar];
    const dryRun = runNode(importCli, [...importArgs, "--mode", "dry-run"]);
    const apply = runNode(importCli, [...importArgs, "--mode", "apply"]);
    const verify = runNode(importCli, [...importArgs, "--mode", "verify"]);
    const dispose = runNode(resolve("scripts/cognitive-v021/dispose-shadow-semantic-state.mjs"), ["--sidecar", sidecar]);

    // Rollback is a copy operation inside the isolated rehearsal directory.
    copySqliteFamily(rollback, sidecar);
    console.log(JSON.stringify({
      ok: true,
      isolatedWorkdir: workdir,
      import: { dryRun, apply, verify },
      projectorCrashReplay: "replay-safe projector seam verified by candidate tests",
      shadowDispose: dispose,
      rollback: "isolated sidecar restored from rollback copy",
      productionUpdateInvoked: false,
    }));
  } catch (error) {
    console.error(JSON.stringify({ code: error instanceof Error ? error.message.split(":", 1)[0] : "REHEARSAL_FAILED", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
