#!/usr/bin/env node
/**
 * Isolated M3+M4 physical qualification on Linux Mint.
 * Does not touch production registry, production workspaces, or capability promotion.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

if (process.platform !== "linux") {
  console.error("REFUSED: physical qualification requires Linux Mint, not Windows.");
  process.exit(2);
}

const { V2ProjectReadRegistry } = await import(join(REPO_ROOT, "apps/sandbox-v2/dist/registry.js"));
const { WorkspaceManager } = await import(join(REPO_ROOT, "apps/sandbox-v2/dist/workspace/workspace-manager.js"));
const { executeWorkspaceExperiment } = await import(join(REPO_ROOT, "apps/sandbox-v2/dist/workspace/executor.js"));
const { executeCandidateVerification, buildVerificationBwrapArgs } = await import(
  join(REPO_ROOT, "apps/sandbox-v2/dist/verification/executor.js")
);
const { computeProvisionalCandidateTreeHash } = await import(
  join(REPO_ROOT, "apps/sandbox-v2/dist/verification/snapshot.js")
);
const { createFirstSliceRecipeCatalog } = await import(
  join(REPO_ROOT, "apps/sandbox-v2/dist/verification/recipe-catalog.js")
);
const { V2_HOST_FACTS } = await import(join(REPO_ROOT, "apps/sandbox-v2/dist/limits.js"));

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function git(cwd, args) {
  return execSync(`git ${args}`, { cwd, encoding: "utf8" }).trim();
}

const liveRepo = resolve(homedir(), "project-ashley");
const liveBefore = {
  sha: git(liveRepo, "rev-parse HEAD"),
  porcelain: git(liveRepo, "status --porcelain"),
  pkg: sha256File(join(liveRepo, "package.json")),
};

const fixtureRoot = mkdtempSync(join(tmpdir(), "ashley-m4-phys-fixture-"));
const workspaceRoot = mkdtempSync(join(tmpdir(), "ashley-m4-phys-ws-"));
mkdirSync(join(fixtureRoot, "src"), { recursive: true });
writeFileSync(join(fixtureRoot, "src", "ok.ts"), "export const n = 1;\n", "utf8");

const entry = {
  projectId: "m4-phys-fixture",
  canonicalRoot: fixtureRoot,
  displayName: "M4 physical fixture",
  enabled: true,
  readAllowed: true,
  candidateWorkspaceAllowed: true,
  engineeringAllowed: false,
  verificationAllowed: true,
  allowedRecipeIds: ["typescript_fixture_compile_v1"],
};
const registry = new V2ProjectReadRegistry([entry]);
const catalog = createFirstSliceRecipeCatalog();
const manager = new WorkspaceManager({ managedRoot: workspaceRoot });
const acquired = await manager.acquireWorkspace({
  projectId: entry.projectId,
  canonicalRoot: fixtureRoot,
});
if (!acquired.ok) throw new Error(`acquire_failed:${acquired.error}`);

const report = {
  suite: "PROJECT_ASHLEY_SANDBOX_V2_M3_M4_PHYSICAL_QUALIFICATION",
  timestamp: new Date().toISOString(),
  host: {
    hostname: execSync("hostname", { encoding: "utf8" }).trim(),
    os: execSync(". /etc/os-release; echo $PRETTY_NAME", { encoding: "utf8", shell: "/bin/bash" }).trim(),
    kernel: execSync("uname -r", { encoding: "utf8" }).trim(),
    node: execSync("node -v", { encoding: "utf8" }).trim(),
    bwrap: execSync(`${V2_HOST_FACTS.BWRAP} --version`, { encoding: "utf8" }).trim(),
    nvmNode: V2_HOST_FACTS.NVM_NODE_PREFIX,
    hostNodeBinExists: existsSync(V2_HOST_FACTS.NODE_BIN),
    nvmNodeExists: existsSync(join(V2_HOST_FACTS.NVM_NODE_PREFIX, "bin/node")),
    tscExists: existsSync(join(V2_HOST_FACTS.NVM_NODE_PREFIX, "lib/node_modules/typescript/bin/tsc")),
  },
  liveBefore,
  scenarios: {},
};

const m3 = await executeWorkspaceExperiment(
  {
    version: 2,
    operation: "workspace.write_file",
    projectId: entry.projectId,
    workspaceId: acquired.workspaceId,
    path: "src/m3-added.ts",
    content: "export const n = 1;\n",
  },
  { registry, workspaceManager: manager, managedWorkspaceRoot: workspaceRoot },
);
const hashAfterM3 = computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot);
report.scenarios.s1_m3 = {
  outcome: m3.outcome,
  error: m3.outcome === "failed" || m3.outcome === "unavailable" ? m3.error : null,
  workspaceId: acquired.workspaceId,
  projectId: entry.projectId,
  candidateHashAfterM3: hashAfterM3,
  liveWitnessInFixture: existsSync(join(fixtureRoot, "src", "ok.ts")),
  candidateHasAddedTs: existsSync(join(acquired.workspaceTreeRoot, "src", "m3-added.ts")),
};

const bwrapArgs = buildVerificationBwrapArgs({
  candidateRoot: acquired.workspaceTreeRoot,
  projectionRoot: "/tmp/ashley-m4-proj-probe",
  executablePath: V2_HOST_FACTS.NODE_BIN,
  argv: ["--version"],
  cwdGuest: "/candidate",
});
const candidateIdx = bwrapArgs.indexOf(acquired.workspaceTreeRoot);
report.scenarios.s3_ro_bind = {
  unshareNet: bwrapArgs.includes("--unshare-net"),
  candidateRoBind: bwrapArgs[candidateIdx - 1] === "--ro-bind",
  guestCandidate: bwrapArgs[candidateIdx + 1] === "/candidate",
};

let roProbe = { exitCode: null, stdout: "", stderr: "" };
try {
  execSync(
    [
      V2_HOST_FACTS.BWRAP,
      "--unshare-user",
      "--unshare-net",
      "--ro-bind",
      acquired.workspaceTreeRoot,
      "/candidate",
      "--ro-bind",
      "/usr",
      "/usr",
      "--symlink",
      "usr/bin",
      "/bin",
      "--dev",
      "/dev",
      "/usr/bin/touch",
      "/candidate/leaked",
    ].join(" "),
    { encoding: "utf8", timeout: 8000 },
  );
  roProbe = { exitCode: 0, stdout: "touch-succeeded", stderr: "" };
} catch (err) {
  roProbe = {
    exitCode: typeof err.status === "number" ? err.status : null,
    stdout: String(err.stdout ?? ""),
    stderr: String(err.stderr ?? err.message ?? err),
  };
}
report.scenarios.s3_ro_probe = roProbe;
report.scenarios.s3_candidateUnchangedAfterProbe = {
  hash: computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot),
  leaked: existsSync(join(acquired.workspaceTreeRoot, "leaked")),
};

const verifyReq = {
  version: 2,
  operation: "workspace.verify",
  projectId: entry.projectId,
  workspaceId: acquired.workspaceId,
  recipeId: "typescript_fixture_compile_v1",
};
const hashBeforeM4 = computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot);
const m4 = await executeCandidateVerification(verifyReq, {
  registry,
  recipeCatalog: catalog,
  workspaceManager: manager,
});
const hashAfterM4 = computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot);
report.scenarios.s2_m4 = {
  dispatchOutcome: m4.outcome,
  error: m4.outcome === "failed" || m4.outcome === "unavailable" ? m4.error : null,
  receipt: m4.verificationReceipt ?? (m4.outcome === "succeeded" ? m4.result : null),
  candidateHashBefore: hashBeforeM4,
  candidateHashAfter: hashAfterM4,
  hashesEqual: hashBeforeM4 === hashAfterM4,
};

writeFileSync(join(acquired.workspaceTreeRoot, "src", "bad.ts"), "export const n: number = 'nope';\n", "utf8");
const hashFailBefore = computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot);
const m4fail = await executeCandidateVerification(verifyReq, {
  registry,
  recipeCatalog: catalog,
  workspaceManager: manager,
});
report.scenarios.s4_verified_failure_attempt = {
  dispatchOutcome: m4fail.outcome,
  error: m4fail.outcome === "failed" || m4fail.outcome === "unavailable" ? m4fail.error : null,
  receipt: m4fail.verificationReceipt ?? (m4fail.outcome === "succeeded" ? m4fail.result : null),
  hashBefore: hashFailBefore,
  hashAfter: computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot),
};

const closed = new V2ProjectReadRegistry([{ ...entry, verificationAllowed: false, allowedRecipeIds: [] }]);
let closedSpawns = 0;
const m4closed = await executeCandidateVerification(verifyReq, {
  registry: closed,
  recipeCatalog: catalog,
  workspaceManager: manager,
  spawnVerification: async () => {
    closedSpawns += 1;
    throw new Error("spawn_must_not_run");
  },
});
report.scenarios.s5_revocation = {
  dispatchOutcome: m4closed.outcome,
  error: m4closed.outcome === "failed" || m4closed.outcome === "unavailable" ? m4closed.error : null,
  closedSpawns,
};

report.liveAfter = {
  sha: git(liveRepo, "rev-parse HEAD"),
  porcelain: git(liveRepo, "status --porcelain"),
  pkg: sha256File(join(liveRepo, "package.json")),
};
report.liveUnchanged =
  report.liveAfter.sha === liveBefore.sha &&
  report.liveAfter.porcelain === liveBefore.porcelain &&
  report.liveAfter.pkg === liveBefore.pkg;

rmSync(fixtureRoot, { recursive: true, force: true });
rmSync(workspaceRoot, { recursive: true, force: true });

console.log(JSON.stringify(report, null, 2));
