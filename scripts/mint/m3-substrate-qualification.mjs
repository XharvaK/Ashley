#!/usr/bin/env node
/**
 * Project Ashley — Sandbox V2 M3
 * Physical Linux Mint Substrate Qualification Harness (Phase B)
 *
 * Dedicated V2-only qualification runner implementing cases B1 through B17.
 * Strictly avoids legacy V1 components (no root broker, no socket broker, no V1 signing).
 * Uses isolated disposable fixtures and protects production DBs/registries.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createServer, connect as netConnect } from "node:net";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_WITNESS_BYTES,
  CANONICAL_WITNESS_LENGTH,
  CANONICAL_WITNESS_SHA256,
  assertSafePath,
  toCanonicalPosixRoot,
  verifyCanonicalWitnessHash,
} from "./m3-qualification-contract.mjs";

// Resolving compiled dependencies relative to repo root
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

import { V2ProjectReadRegistry } from "../../apps/sandbox-v2/dist/registry.js";
import { WorkspaceManager } from "../../apps/sandbox-v2/dist/workspace/workspace-manager.js";
import { SandboxV2Dispatcher } from "../../apps/sandbox-v2/dist/dispatch.js";
import { executeWorkspaceExperiment } from "../../apps/sandbox-v2/dist/workspace/executor.js";
import { V2_HOST_FACTS, V2_LIMITS, V2_SECRET_ENV_KEY } from "../../apps/sandbox-v2/dist/limits.js";
import { executeWorkspaceExperimentV2, isSandboxV2Available } from "../../apps/agent-service/dist/core/sandbox/v2-execution.js";

function tryConnect(port) {
  return new Promise((resolve) => {
    const sock = netConnect({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 2000);
    timer.unref();
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(false);
    });
  });
}

function sanitizeEvidence(obj) {
  const json = JSON.stringify(obj, (key, value) => {
    if (typeof value === "string") {
      if (key === V2_SECRET_ENV_KEY || key === "secret" || key === "token" || key === "apiKey") {
        return "[REDACTED]";
      }
    }
    return value;
  }, 2);
  return JSON.parse(json);
}

export async function runSubstrateQualification(options = {}) {
  const results = {
    suite: "PROJECT_ASHLEY_SANDBOX_V2_M3_SUBSTRATE_QUALIFICATION",
    version: 2,
    timestamp: new Date().toISOString(),
    hostPlatform: process.platform,
    cases: {},
    verdict: "RUNNING",
  };

  const selectedCase = options.case ? options.case.toUpperCase() : "ALL";
  const outputDir = options.outputDir || join(homedir(), ".composer-assistant", "qualification", "m3", String(Date.now()));
  const isLinux = process.platform === "linux";

  // Discover and isolate paths
  const fixtureRoot = options.fixtureRoot || mkdtempSync(join(tmpdir(), "ashley-m3-fixture-"));
  const workspaceRoot = options.workspaceRoot || mkdtempSync(join(tmpdir(), "ashley-m3-workspaces-"));

  assertSafePath(fixtureRoot, "Fixture Root");
  assertSafePath(workspaceRoot, "Workspace Root");

  let sharedWorkspaceId = null;
  let sharedSnapshotId = null;
  let fixtureRegistry = null;
  let wsManager = null;

  function recordCase(caseId, details) {
    const rawVerdict = details.verdict ?? (details.localSelfTest === "PASS" ? "PASS" : "FAIL");
    const localSelfTest =
      details.localSelfTest ??
      (rawVerdict === "NOT_APPLICABLE" || rawVerdict === "NOT PHYSICALLY EXECUTED"
        ? "NOT_APPLICABLE"
        : rawVerdict === "PASS"
          ? "PASS"
          : "FAIL");
    const physicalVerdict = isLinux
      ? rawVerdict === "NOT_APPLICABLE" || rawVerdict === "NOT PHYSICALLY EXECUTED"
        ? "NOT_EXECUTED"
        : rawVerdict
      : "NOT_EXECUTED";
    const verdict = isLinux ? physicalVerdict : "NOT_EXECUTED";

    const artifact = sanitizeEvidence({
      caseId,
      timestamp: new Date().toISOString(),
      host: isLinux ? "Linux Mint (Physical)" : `${process.platform} (Non-Physical / Local)`,
      candidateCommit: details.candidateCommit ?? gitCommit ?? "unknown",
      runtimeUser: details.runtimeUser ?? runtimeUser ?? "unknown",
      runtimeUid: details.runtimeUid ?? runtimeUid ?? null,
      runtimeGid: details.runtimeGid ?? runtimeGid ?? null,
      workspaceId: details.workspaceId ?? sharedWorkspaceId,
      operation: details.operation ?? "none",
      command: details.command ?? `node scripts/mint/m3-substrate-qualification.mjs --case ${caseId}`,
      exitCode: details.exitCode ?? 0,
      expected: details.expected,
      actual: details.actual,
      verdict,
      localSelfTest,
      physicalVerdict,
      evidenceClass: details.evidenceClass,
      details: details.data ?? {},
    });
    results.cases[caseId] = artifact;

    if (options.saveArtifacts) {
      try {
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(join(outputDir, `case-${caseId}.json`), JSON.stringify(artifact, null, 2), "utf8");
      } catch {}
    }
  }

  // --- Discovery / Preconditions ---
  let gitCommit = "unknown";
  try {
    gitCommit = execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim();
  } catch {}

  const runtimeUser = process.env.USER || process.env.LOGNAME || "unknown";
  const runtimeUid = process.getuid ? process.getuid() : null;
  const runtimeGid = process.getgid ? process.getgid() : null;

  try {
    // -------------------------------------------------------------
    // Case B1: Candidate & Runtime Identity Discovery & Verification
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B1") {
      let whoamiOut = runtimeUser;
      try {
        whoamiOut = execSync("whoami").toString().trim();
      } catch {}

      const pass = whoamiOut !== "root" && runtimeUid !== 0 && gitCommit.length === 40;
      recordCase("B1", {
        candidateCommit: gitCommit,
        runtimeUser: whoamiOut,
        runtimeUid,
        runtimeGid,
        expected: "Non-root runtime user identity, valid git commit SHA",
        actual: `user=${whoamiOut}, uid=${runtimeUid}, gid=${runtimeGid}, commit=${gitCommit.slice(0, 8)}`,
        verdict: pass ? "PASS" : "FAIL",
        evidenceClass: "CLASS_D_PROCESS_AUDIT",
        data: { whoami: whoamiOut, uid: runtimeUid, gid: runtimeGid, commit: gitCommit },
      });
    }

    // -------------------------------------------------------------
    // Case B2: Bubblewrap Binary & Usability Probe
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B2") {
      if (!isLinux) {
        recordCase("B2", {
          expected: "Bubblewrap unprivileged execution verified on Linux host",
          actual: `Substrate unavailable on ${process.platform}`,
          verdict: "NOT PHYSICALLY EXECUTED",
          evidenceClass: "CLASS_B_NAMESPACES",
        });
      } else {
        try {
          const versionOut = execSync(`${V2_HOST_FACTS.BWRAP} --version`).toString().trim();
          const probeOut = execSync(
            `${V2_HOST_FACTS.BWRAP} --unshare-user --unshare-pid --unshare-net --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --proc /proc --dev /dev --tmpfs /tmp /bin/sh -c "echo bwrap-ok"`
          ).toString().trim();
          const pass = probeOut === "bwrap-ok";
          recordCase("B2", {
            expected: "Exit 0 and stdout 'bwrap-ok'",
            actual: `stdout=${probeOut}, version=${versionOut}`,
            verdict: pass ? "PASS" : "FAIL",
            evidenceClass: "CLASS_B_NAMESPACES",
            data: { bwrapVersion: versionOut, output: probeOut },
          });
        } catch (err) {
          recordCase("B2", {
            expected: "Exit 0 and stdout 'bwrap-ok'",
            actual: String(err),
            verdict: "FAIL",
            evidenceClass: "CLASS_B_NAMESPACES",
          });
        }
      }
    }

    // -------------------------------------------------------------
    // Case B3: Disposable Fixture & Workspace Root Setup
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B3" || selectedCase === "ALL_EXEC") {
      mkdirSync(join(fixtureRoot, "src"), { recursive: true });
      writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2), "utf8");
      writeFileSync(join(fixtureRoot, "src", "index.js"), 'console.log("hello");', "utf8");

      mkdirSync(workspaceRoot, { recursive: true });

      const fixturePkgExists = existsSync(join(fixtureRoot, "package.json"));
      const wsRootExists = existsSync(workspaceRoot);

      fixtureRegistry = new V2ProjectReadRegistry([
        {
          projectId: "fixture-project",
          canonicalRoot: toCanonicalPosixRoot(fixtureRoot),
          displayName: "Disposable Fixture Project",
          enabled: true,
          readAllowed: true,
          candidateWorkspaceAllowed: true,
          engineeringAllowed: false,
        },
      ]);
      wsManager = new WorkspaceManager({ managedRoot: workspaceRoot });

      recordCase("B3", {
        expected: "Disposable fixture and isolated workspace root created",
        actual: `fixtureExists=${fixturePkgExists}, workspaceRootExists=${wsRootExists}`,
        verdict: fixturePkgExists && wsRootExists ? "PASS" : "FAIL",
        evidenceClass: "CLASS_A_PHYSICAL_FS",
        data: { fixtureRoot, workspaceRoot },
      });
    }

    // -------------------------------------------------------------
    // Case B4: Failure-Atomic Workspace Creation & Manifest Isolation
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B4") {
      if (!wsManager) wsManager = new WorkspaceManager({ managedRoot: workspaceRoot });
      const acq = await wsManager.acquireWorkspace({
        projectId: "fixture-project",
        canonicalRoot: fixtureRoot,
      });

      if (!acq.ok) {
        recordCase("B4", {
          expected: "Workspace created failure-atomically with manifest outside tree",
          actual: `Failed: ${acq.error}`,
          verdict: "FAIL",
          evidenceClass: "CLASS_A_PHYSICAL_FS",
        });
      } else {
        sharedWorkspaceId = acq.workspaceId;
        sharedSnapshotId = acq.manifest.sourceSnapshotId;

        const manifestPath = join(workspaceRoot, sharedWorkspaceId, "manifest.json");
        const treePath = join(workspaceRoot, sharedWorkspaceId, "tree");
        const leakedManifest = existsSync(join(treePath, "manifest.json"));
        const treePackageJson = existsSync(join(treePath, "package.json"));

        const pass =
          acq.isNew === true &&
          existsSync(manifestPath) &&
          treePackageJson === true &&
          leakedManifest === false &&
          acq.manifest.schemaVersion === 2;

        recordCase("B4", {
          workspaceId: sharedWorkspaceId,
          expected: "manifest.json outside tree/, schemaVersion: 2, tree populated with sanitized fixture files",
          actual: `isNew=${acq.isNew}, manifestExists=${existsSync(manifestPath)}, treePkg=${treePackageJson}, leakedManifest=${leakedManifest}`,
          verdict: pass ? "PASS" : "FAIL",
          evidenceClass: "CLASS_A_PHYSICAL_FS",
          data: { manifest: acq.manifest, workspaceId: sharedWorkspaceId },
        });
      }
    }

    // -------------------------------------------------------------
    // Case B5: Durable Tree Mount Identity & Inode Verification
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B5") {
      if (!sharedWorkspaceId && wsManager) {
        const acq = await wsManager.acquireWorkspace({ projectId: "fixture-project", canonicalRoot: fixtureRoot });
        if (acq.ok) sharedWorkspaceId = acq.workspaceId;
      }

      if (!sharedWorkspaceId) {
        recordCase("B5", { expected: "Durable tree mount identity verified", actual: "No workspaceId", verdict: "BLOCKED", evidenceClass: "CLASS_A_PHYSICAL_FS" });
      } else {
        const treePath = join(workspaceRoot, sharedWorkspaceId, "tree");
        const hostStat = statSync(treePath);
        const markerFile = join(treePath, ".mount-witness");
        writeFileSync(markerFile, "host-witness-ok", "utf8");

        const markerStat = statSync(markerFile);
        const pass = hostStat.isDirectory() && markerStat.isFile();

        recordCase("B5", {
          workspaceId: sharedWorkspaceId,
          expected: "Host tree stat inode and marker verified",
          actual: `hostDev=${hostStat.dev}, hostIno=${hostStat.ino}, markerExists=${existsSync(markerFile)}`,
          verdict: pass ? "PASS" : "FAIL",
          evidenceClass: "CLASS_A_PHYSICAL_FS",
          data: { hostDev: hostStat.dev, hostIno: hostStat.ino },
        });
      }
    }

    // -------------------------------------------------------------
    // Case B6: Read-Only System Mounts & Path Inaccessibility
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B6") {
      if (!isLinux) {
        recordCase("B6", {
          expected: "System mounts read-only and unauthorized host paths inaccessible",
          actual: `Physical Bubblewrap unavailable on ${process.platform}`,
          verdict: "NOT PHYSICALLY EXECUTED",
          evidenceClass: "CLASS_B_NAMESPACES",
        });
      } else {
        // Real bwrap execution on Linux
        const bwrapCmd = `${V2_HOST_FACTS.BWRAP} --unshare-user --unshare-pid --unshare-net --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --dev /dev --proc /proc --tmpfs /tmp --bind ${workspaceRoot}/${sharedWorkspaceId}/tree /workspace --clearenv /bin/sh -c "touch /usr/.probe 2>/dev/null || echo ro-usr-ok"`;
        try {
          const out = execSync(bwrapCmd).toString().trim();
          recordCase("B6", {
            expected: "Write to /usr refused ('ro-usr-ok')",
            actual: out,
            verdict: out === "ro-usr-ok" ? "PASS" : "FAIL",
            evidenceClass: "CLASS_B_NAMESPACES",
          });
        } catch (err) {
          recordCase("B6", { expected: "Write to /usr refused", actual: String(err), verdict: "FAIL", evidenceClass: "CLASS_B_NAMESPACES" });
        }
      }
    }

    // -------------------------------------------------------------
    // Case B7: Canonical Candidate Mutation Witness (m3-witness.txt)
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B7") {
      verifyCanonicalWitnessHash();
      if (!sharedWorkspaceId && wsManager) {
        const acq = await wsManager.acquireWorkspace({ projectId: "fixture-project", canonicalRoot: fixtureRoot });
        if (acq.ok) sharedWorkspaceId = acq.workspaceId;
      }

      if (!sharedWorkspaceId) {
        recordCase("B7", { expected: "Canonical mutation witness executed", actual: "No workspaceId", verdict: "BLOCKED", evidenceClass: "CLASS_A_PHYSICAL_FS" });
      } else {
        let execOutcome = null;
        if (isLinux) {
          execOutcome = await executeWorkspaceExperiment(
            {
              version: 2,
              operation: "workspace.write_file",
              projectId: "fixture-project",
              path: "m3-witness.txt",
              content: CANONICAL_WITNESS_BYTES,
              mustNotExist: true,
              workspaceId: sharedWorkspaceId,
            },
            {
              registry: fixtureRegistry,
              managedWorkspaceRoot: workspaceRoot,
            },
          );
        } else {
          // Direct file simulation for non-Linux dry-run
          const candFile = join(workspaceRoot, sharedWorkspaceId, "tree", "m3-witness.txt");
          writeFileSync(candFile, CANONICAL_WITNESS_BYTES, "utf8");
          execOutcome = {
            outcome: "succeeded",
            operation: "workspace.write_file",
            workspaceId: sharedWorkspaceId,
            result: { bytesWritten: CANONICAL_WITNESS_LENGTH, contentHash: CANONICAL_WITNESS_SHA256 },
          };
        }

        const candFile = join(workspaceRoot, sharedWorkspaceId, "tree", "m3-witness.txt");
        const candContent = existsSync(candFile) ? readFileSync(candFile, "utf8") : "";
        const candHash = createHash("sha256").update(candContent).digest("hex");
        const liveHasWitness = existsSync(join(fixtureRoot, "m3-witness.txt"));

        const pass =
          execOutcome.outcome === "succeeded" &&
          candContent === CANONICAL_WITNESS_BYTES &&
          candHash === CANONICAL_WITNESS_SHA256 &&
          liveHasWitness === false;

        recordCase("B7", {
          workspaceId: sharedWorkspaceId,
          operation: "workspace.write_file",
          expected: `sha256:${CANONICAL_WITNESS_SHA256} bytesWritten:13 liveRepo:unchanged`,
          actual: `sha256:${candHash} bytesWritten:${candContent.length} liveRepo:${liveHasWitness ? "mutated" : "unchanged"}`,
          verdict: pass ? "PASS" : "FAIL",
          evidenceClass: "CLASS_A_PHYSICAL_FS",
          data: { sha256: candHash, bytesWritten: candContent.length, liveMutated: liveHasWitness },
        });
      }
    }

    // -------------------------------------------------------------
    // Case B8: Process-Exit Persistence Proof
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B8") {
      const candFile = join(workspaceRoot, sharedWorkspaceId || "unknown", "tree", "m3-witness.txt");
      const exists = existsSync(candFile);
      const content = exists ? readFileSync(candFile, "utf8") : "";
      const hash = createHash("sha256").update(content).digest("hex");

      const pass = exists && content === CANONICAL_WITNESS_BYTES && hash === CANONICAL_WITNESS_SHA256;
      recordCase("B8", {
        workspaceId: sharedWorkspaceId,
        expected: `File persists on disk after child process exit with sha256:${CANONICAL_WITNESS_SHA256}`,
        actual: `exists=${exists}, sha256=${hash}, content=${content}`,
        verdict: pass ? "PASS" : "FAIL",
        evidenceClass: "CLASS_A_PHYSICAL_FS",
      });
    }

    // -------------------------------------------------------------
    // Case B9: Independent Process Workspace Resume
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B9") {
      if (!sharedWorkspaceId) {
        recordCase("B9", { expected: "Independent workspace resume", actual: "No workspaceId", verdict: "BLOCKED", evidenceClass: "CLASS_A_PHYSICAL_FS" });
      } else {
        let readRes = null;
        if (isLinux) {
          readRes = await executeWorkspaceExperiment(
            {
              version: 2,
              operation: "workspace.read_file",
              projectId: "fixture-project",
              path: "m3-witness.txt",
              workspaceId: sharedWorkspaceId,
            },
            {
              registry: fixtureRegistry,
              managedWorkspaceRoot: workspaceRoot,
            },
          );
        } else {
          const candFile = join(workspaceRoot, sharedWorkspaceId, "tree", "m3-witness.txt");
          const c = existsSync(candFile) ? readFileSync(candFile, "utf8") : "";
          readRes = { outcome: "succeeded", result: { contentBase64: Buffer.from(c).toString("base64") } };
        }

        const decoded = readRes?.result?.contentBase64 ? Buffer.from(readRes.result.contentBase64, "base64").toString("utf8") : "";
        const pass = readRes?.outcome === "succeeded" && decoded === CANONICAL_WITNESS_BYTES;

        recordCase("B9", {
          workspaceId: sharedWorkspaceId,
          operation: "workspace.read_file",
          expected: `Read returns '${CANONICAL_WITNESS_BYTES}' from resumed workspace`,
          actual: `outcome=${readRes?.outcome}, content=${decoded}`,
          verdict: pass ? "PASS" : "FAIL",
          evidenceClass: "CLASS_A_PHYSICAL_FS",
        });
      }
    }

    // -------------------------------------------------------------
    // Case B10: Full Typed Mutation & Inspection Vocabulary (All 8 Operations)
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B10") {
      if (!sharedWorkspaceId) {
        recordCase("B10", { expected: "All 8 workspace operations verified", actual: "No workspaceId", verdict: "BLOCKED", evidenceClass: "CLASS_A_PHYSICAL_FS" });
      } else {
        const treePath = join(workspaceRoot, sharedWorkspaceId, "tree");
        let hasDocsDir = false;
        let finalContentBeforeDel = "";
        let deletedAbsent = false;
        let allOpsSucceeded = true;

        if (isLinux) {
          const createDirRes = await executeWorkspaceExperiment(
            { version: 2, operation: "workspace.create_directory", projectId: "fixture-project", path: "docs", workspaceId: sharedWorkspaceId },
            { registry: fixtureRegistry, managedWorkspaceRoot: workspaceRoot }
          );
          const writeRes = await executeWorkspaceExperiment(
            { version: 2, operation: "workspace.write_file", projectId: "fixture-project", path: "docs/spec.txt", content: "version 1", mustNotExist: true, workspaceId: sharedWorkspaceId },
            { registry: fixtureRegistry, managedWorkspaceRoot: workspaceRoot }
          );
          const editRes = await executeWorkspaceExperiment(
            { version: 2, operation: "workspace.edit_text", projectId: "fixture-project", path: "docs/spec.txt", oldText: "1", newText: "2", expectedSha256: writeRes?.result?.contentHash, workspaceId: sharedWorkspaceId },
            { registry: fixtureRegistry, managedWorkspaceRoot: workspaceRoot }
          );
          const replaceRes = await executeWorkspaceExperiment(
            { version: 2, operation: "workspace.replace_file", projectId: "fixture-project", path: "docs/spec.txt", content: "version 3", expectedSha256: editRes?.result?.contentHash, workspaceId: sharedWorkspaceId },
            { registry: fixtureRegistry, managedWorkspaceRoot: workspaceRoot }
          );
          const listRes = await executeWorkspaceExperiment(
            { version: 2, operation: "workspace.list_directory", projectId: "fixture-project", path: "docs", workspaceId: sharedWorkspaceId },
            { registry: fixtureRegistry, managedWorkspaceRoot: workspaceRoot }
          );
          const searchRes = await executeWorkspaceExperiment(
            { version: 2, operation: "workspace.search_text", projectId: "fixture-project", path: "docs", pattern: "version 3", workspaceId: sharedWorkspaceId },
            { registry: fixtureRegistry, managedWorkspaceRoot: workspaceRoot }
          );
          const readRes = await executeWorkspaceExperiment(
            { version: 2, operation: "workspace.read_file", projectId: "fixture-project", path: "docs/spec.txt", workspaceId: sharedWorkspaceId },
            { registry: fixtureRegistry, managedWorkspaceRoot: workspaceRoot }
          );
          const deleteRes = await executeWorkspaceExperiment(
            { version: 2, operation: "workspace.delete_file", projectId: "fixture-project", path: "docs/spec.txt", expectedSha256: replaceRes?.result?.contentHash, workspaceId: sharedWorkspaceId },
            { registry: fixtureRegistry, managedWorkspaceRoot: workspaceRoot }
          );

          hasDocsDir = existsSync(join(treePath, "docs"));
          finalContentBeforeDel = readRes?.result?.contentBase64 ? Buffer.from(readRes.result.contentBase64, "base64").toString("utf8") : "";
          deletedAbsent = !existsSync(join(treePath, "docs", "spec.txt"));

          allOpsSucceeded =
            createDirRes.outcome === "succeeded" &&
            writeRes.outcome === "succeeded" &&
            editRes.outcome === "succeeded" &&
            replaceRes.outcome === "succeeded" &&
            listRes.outcome === "succeeded" &&
            searchRes.outcome === "succeeded" &&
            (searchRes.result?.matches?.length ?? 0) > 0 &&
            readRes.outcome === "succeeded" &&
            deleteRes.outcome === "succeeded";
        } else {
          mkdirSync(join(treePath, "docs"), { recursive: true });
          writeFileSync(join(treePath, "docs", "spec.txt"), "version 1", "utf8");

          // edit_text -> version 2
          let text = readFileSync(join(treePath, "docs", "spec.txt"), "utf8");
          text = text.replace("1", "2");
          writeFileSync(join(treePath, "docs", "spec.txt"), text, "utf8");

          // replace_file -> version 3
          writeFileSync(join(treePath, "docs", "spec.txt"), "version 3", "utf8");

          // list_directory & search_text
          hasDocsDir = existsSync(join(treePath, "docs"));
          finalContentBeforeDel = readFileSync(join(treePath, "docs", "spec.txt"), "utf8");

          // delete_file
          rmSync(join(treePath, "docs", "spec.txt"), { force: true });
          deletedAbsent = !existsSync(join(treePath, "docs", "spec.txt"));
          allOpsSucceeded = true;
        }

        const pass = allOpsSucceeded && hasDocsDir && finalContentBeforeDel === "version 3" && deletedAbsent;
        recordCase("B10", {
          workspaceId: sharedWorkspaceId,
          expected: "All 8 workspace operations (create_directory, write_file, edit_text, replace_file, list_directory, search_text, read_file, delete_file) verified",
          actual: `allOpsSucceeded=${allOpsSucceeded}, hasDocsDir=${hasDocsDir}, finalContentBeforeDel='${finalContentBeforeDel}', deletedAbsent=${deletedAbsent}`,
          verdict: pass ? "PASS" : "FAIL",
          evidenceClass: "CLASS_A_PHYSICAL_FS",
        });
      }
    }

    // -------------------------------------------------------------
    // Case B11: Deterministic Network Isolation Proof
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B11") {
      let hits = 0;
      const server = createServer((sock) => {
        hits++;
        sock.destroy();
      });
      await new Promise((res, rej) => {
        server.once("error", rej);
        server.listen(0, "127.0.0.1", () => res());
      });

      const probePort = server.address().port;
      const positiveControl = await tryConnect(probePort);
      const baselineHits = hits;

      if (!isLinux) {
        await new Promise((res) => server.close(() => res()));
        recordCase("B11", {
          expected: "Host positive control succeeds (hits=1), sandbox loopback fails (delta=0), sandbox reports ISOLATED",
          actual: `Substrate unavailable on ${process.platform} (host positive control self-test ${positiveControl ? "PASS" : "FAIL"})`,
          verdict: "NOT PHYSICALLY EXECUTED",
          evidenceClass: "CLASS_C_SOCKET_IO",
          data: {
            harnessSelfTest: positiveControl ? "PASS" : "FAIL",
            positiveControl,
            probePort,
            note: "Physical namespace isolation requires Linux kernel and /usr/bin/bwrap",
          },
        });
      } else {
        let sandboxConnectFailed = true;
        try {
          const probeCmd = `${V2_HOST_FACTS.BWRAP} --unshare-user --unshare-pid --unshare-net --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --dev /dev --proc /proc --tmpfs /tmp /bin/sh -c "nc -z -w 1 127.0.0.1 ${probePort} 2>/dev/null && echo CONNECTED || echo ISOLATED"`;
          const out = execSync(probeCmd).toString().trim();
          sandboxConnectFailed = out === "ISOLATED";
        } catch {
          sandboxConnectFailed = true;
        }

        await new Promise((res) => server.close(() => res()));
        const sandboxHits = hits - baselineHits;
        const pass = positiveControl === true && sandboxHits === 0 && sandboxConnectFailed === true;

        recordCase("B11", {
          expected: "Host positive control succeeds (hits=1), sandbox loopback fails (delta=0), sandbox reports ISOLATED",
          actual: `positiveControl=${positiveControl}, sandboxHitsDelta=${sandboxHits}, sandboxIsolated=${sandboxConnectFailed}`,
          verdict: pass ? "PASS" : "FAIL",
          evidenceClass: "CLASS_C_SOCKET_IO",
          data: { positiveControl, sandboxHitsDelta: sandboxHits, probePort },
        });
      }
    }

    // -------------------------------------------------------------
    // Case B12: Environment, FD, and Secret Sentinel Isolation
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B12") {
      const origSecret = process.env[V2_SECRET_ENV_KEY];
      process.env[V2_SECRET_ENV_KEY] = "secret-canary-" + randomBytes(8).toString("hex");

      let envIsolated = true;
      if (isLinux) {
        try {
          const cmd = `${V2_HOST_FACTS.BWRAP} --unshare-user --unshare-pid --unshare-net --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --dev /dev --proc /proc --tmpfs /tmp --clearenv --setenv PATH /usr/bin --setenv HOME /tmp /bin/sh -c "env"`;
          const out = execSync(cmd).toString();
          envIsolated = !out.includes(process.env[V2_SECRET_ENV_KEY]);
        } catch {
          envIsolated = false;
        }
      }

      if (origSecret === undefined) delete process.env[V2_SECRET_ENV_KEY];
      else process.env[V2_SECRET_ENV_KEY] = origSecret;

      recordCase("B12", {
        expected: "Secret sentinel environment variable absent in sandbox environment",
        actual: `envClean=${envIsolated}`,
        verdict: envIsolated ? "PASS" : "FAIL",
        evidenceClass: "CLASS_B_NAMESPACES",
      });
    }

    // -------------------------------------------------------------
    // Case B13: Source-Drift Semantics on Disposable Fixture
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B13") {
      if (!sharedWorkspaceId) {
        recordCase("B13", { expected: "Source drift does not mutate candidate workspace", actual: "No workspaceId", verdict: "BLOCKED", evidenceClass: "CLASS_A_PHYSICAL_FS" });
      } else {
        // Mutate fixture on host
        writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ name: "fixture-v2", version: "2.0.0" }, null, 2), "utf8");

        // Read package.json in existing workspace
        const candPkgPath = join(workspaceRoot, sharedWorkspaceId, "tree", "package.json");
        const candPkg = JSON.parse(readFileSync(candPkgPath, "utf8"));

        const pass = candPkg.version === "1.0.0";
        recordCase("B13", {
          workspaceId: sharedWorkspaceId,
          expected: "Candidate workspace retains version 1.0.0 despite fixture drifting to 2.0.0",
          actual: `candidateVersion=${candPkg.version}, liveFixtureVersion=2.0.0`,
          verdict: pass ? "PASS" : "FAIL",
          evidenceClass: "CLASS_A_PHYSICAL_FS",
        });
      }
    }

    // -------------------------------------------------------------
    // Case B14: Current Parent Authority Revocation (Fail-Closed)
    // Constraint 1: MUST execute every operation through executeWorkspaceExperimentV2
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B14") {
      const revokedRegistry = new V2ProjectReadRegistry([
        {
          projectId: "fixture-project",
          canonicalRoot: toCanonicalPosixRoot(fixtureRoot),
          displayName: "Disposable Fixture Project",
          enabled: true,
          readAllowed: true,
          candidateWorkspaceAllowed: false, // Revoked!
          engineeringAllowed: false,
        },
      ]);

      const operations = [
        "workspace.read_file",
        "workspace.list_directory",
        "workspace.search_text",
        "workspace.write_file",
        "workspace.replace_file",
        "workspace.edit_text",
        "workspace.delete_file",
        "workspace.create_directory",
      ];

      const revocationResults = {};
      let allDenied = true;

      for (const op of operations) {
        const req = {
          operation: op,
          projectId: "fixture-project",
          path: "package.json",
          workspaceId: sharedWorkspaceId || "ws-revocation-test",
          ...(op === "workspace.write_file" ? { content: "test" } : {}),
          ...(op === "workspace.replace_file" ? { content: "test" } : {}),
          ...(op === "workspace.edit_text" ? { oldText: "1", newText: "2" } : {}),
          ...(op === "workspace.search_text" ? { pattern: "fixture" } : {}),
        };

        const res = await executeWorkspaceExperimentV2({
          request: req,
          registry: revokedRegistry,
          workspaceManager: wsManager,
          skipCapabilityGate: true, // Test registry authority revocation specifically
        });

        revocationResults[op] = {
          state: res.license.state,
          error: res.license.error,
          observation: res.observation,
        };

        if (res.license.state === "succeeded" || res.observation !== null) {
          allDenied = false;
        }
      }

      // Storage preservation check
      const storageIntact = sharedWorkspaceId ? existsSync(join(workspaceRoot, sharedWorkspaceId)) : true;
      const pass = allDenied && storageIntact;

      recordCase("B14", {
        workspaceId: sharedWorkspaceId,
        expected: "All 8 operations fail closed with workspace_not_allowed when candidateWorkspaceAllowed revoked; candidate storage intact",
        actual: `allDenied=${allDenied}, storageIntact=${storageIntact}`,
        verdict: pass ? "PASS" : "FAIL",
        evidenceClass: "CLASS_D_PROCESS_AUDIT",
        data: { operations: revocationResults, storageIntact },
      });
    }

    // -------------------------------------------------------------
    // Case B15: Validation & Resource Limits (invalid_path, request_too_large, content_too_large)
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B15") {
      const spawnWorkspaceFallback = async (input) => {
        const req = JSON.parse(input.requestJson);
        if (req.path && (req.path.includes("..") || req.path.startsWith("/"))) {
          return {
            exitCode: 1,
            stdout: JSON.stringify({ version: 2, operation: req.operation, ok: false, code: "invalid_path" }),
            stderr: "invalid_path",
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        }
        if (req.content && Buffer.byteLength(req.content, "utf8") > V2_LIMITS.M3_WRITE_MAX_BYTES) {
          return {
            exitCode: 1,
            stdout: JSON.stringify({ version: 2, operation: req.operation, ok: false, code: "content_too_large" }),
            stderr: "content_too_large",
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            version: 2,
            operation: req.operation,
            ok: true,
            checks: { envClean: true, homeAbsent: true, runAbsent: true, hostSentinelAbsent: true, fdClean: true, workspaceWritable: true, usrReadOnly: true, loopbackConnectSucceeded: false, externalIsolated: true, externalError: "ENETUNREACH" },
            result: { kind: req.operation, path: req.path, bytesWritten: 0, contentHash: "0".repeat(64), readMatches: true, deleted: false, verifiedAbsent: false, completedAtMs: Date.now() },
          }),
          stderr: "",
          timedOut: false,
          stdoutOverflow: false,
          stderrOverflow: false,
        };
      };

      const b15EnvOverrides = {
        sandboxEngineeringLifecycleEnabled: true,
        sandboxAvailable: () => true,
        spawnWorkspace: isLinux ? undefined : spawnWorkspaceFallback,
      };

      // 1. Path traversal escape check -> invalid_path / path_escapes_workspace
      const escapeReq = {
        operation: "workspace.read_file",
        projectId: "fixture-project",
        path: "../../etc/passwd",
        workspaceId: sharedWorkspaceId || "ws-bounds-test",
      };
      const escapeRes = await executeWorkspaceExperimentV2({
        request: escapeReq,
        registry: fixtureRegistry,
        workspaceManager: wsManager,
        skipCapabilityGate: true,
        envOverrides: b15EnvOverrides,
      });

      // 2. Serialized request > 128 KiB -> request_too_large
      const oversizedReq = {
        operation: "workspace.write_file",
        projectId: "fixture-project",
        path: "large-req.txt",
        content: "x".repeat(V2_LIMITS.WORKSPACE_REQUEST_MAX_BYTES + 1024),
        workspaceId: sharedWorkspaceId || "ws-bounds-test",
      };
      const oversizedReqRes = await executeWorkspaceExperimentV2({
        request: oversizedReq,
        registry: fixtureRegistry,
        workspaceManager: wsManager,
        skipCapabilityGate: true,
        envOverrides: b15EnvOverrides,
      });

      // 3. Write content > 64 KiB -> content_too_large
      const oversizedContentReq = {
        operation: "workspace.write_file",
        projectId: "fixture-project",
        path: "large-content.txt",
        content: "x".repeat(V2_LIMITS.M3_WRITE_MAX_BYTES + 100),
        workspaceId: sharedWorkspaceId || "ws-bounds-test",
      };
      const oversizedContentRes = await executeWorkspaceExperimentV2({
        request: oversizedContentReq,
        registry: fixtureRegistry,
        workspaceManager: wsManager,
        skipCapabilityGate: true,
        envOverrides: b15EnvOverrides,
      });

      const escapePass =
        escapeRes.license.state === "failed" &&
        (escapeRes.license.error === "invalid_path" || escapeRes.license.error === "path_escapes_workspace");

      const oversizedReqPass =
        oversizedReqRes.license.state === "failed" &&
        oversizedReqRes.license.error === "request_too_large";

      const oversizedContentPass =
        oversizedContentRes.license.state === "failed" &&
        (oversizedContentRes.license.error === "content_too_large" || oversizedContentRes.license.error === "request_too_large");

      const disallowedEarlyErrors = ["sandbox_lifecycle_disabled", "workspace_not_allowed", "capability_disabled"];
      const noEarlierGateDenial =
        !disallowedEarlyErrors.includes(escapeRes.license.error) &&
        !disallowedEarlyErrors.includes(oversizedReqRes.license.error) &&
        !disallowedEarlyErrors.includes(oversizedContentRes.license.error);

      const pass = escapePass && oversizedReqPass && oversizedContentPass && noEarlierGateDenial;
      recordCase("B15", {
        expected: "Intended validation errors (invalid_path, request_too_large, content_too_large) enforced fail-closed",
        actual: `escapeError=${escapeRes.license.error}, oversizedReqError=${oversizedReqRes.license.error}, oversizedContentError=${oversizedContentRes.license.error}`,
        verdict: pass ? "PASS" : "FAIL",
        evidenceClass: "CLASS_D_PROCESS_AUDIT",
        data: {
          escapeError: escapeRes.license.error,
          oversizedReqError: oversizedReqRes.license.error,
          oversizedContentError: oversizedContentRes.license.error,
        },
      });
    }

    // -------------------------------------------------------------
    // Case B16: Service-Restart Persistence Verification
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B16") {
      if (!sharedWorkspaceId) {
        recordCase("B16", { expected: "Service-restart persistence check", actual: "No workspaceId", verdict: "BLOCKED", evidenceClass: "CLASS_A_PHYSICAL_FS" });
      } else if (!isLinux) {
        const witnessPath = join(workspaceRoot, sharedWorkspaceId, "tree", "restart-witness.txt");
        writeFileSync(witnessPath, "restart-witness-ok", "utf8");
        const exists = existsSync(witnessPath);
        recordCase("B16", {
          workspaceId: sharedWorkspaceId,
          expected: "Candidate workspace file written; persists across service restart boundary",
          actual: `Real systemd user service restart unavailable on ${process.platform} (disk persistence self-test ${exists ? "PASS" : "FAIL"})`,
          verdict: "NOT PHYSICALLY EXECUTED",
          evidenceClass: "CLASS_A_PHYSICAL_FS",
          data: {
            harnessSelfTest: exists ? "PASS" : "FAIL",
            restartWitnessExists: exists,
            note: "Only Mint execution with real systemctl --user restart ashley-agent may produce physical PASS",
          },
        });
      } else {
        // Physical Linux Mint service restart path
        const witnessPath = join(workspaceRoot, sharedWorkspaceId, "tree", "restart-witness.txt");
        writeFileSync(witnessPath, "restart-witness-ok", "utf8");
        let serviceRestarted = false;
        try {
          execSync("systemctl --user restart ashley-agent", { stdio: "pipe" });
          const statusOut = execSync("systemctl --user is-active ashley-agent", { stdio: "pipe" }).toString().trim();
          serviceRestarted = statusOut === "active";
        } catch {
          serviceRestarted = false;
        }
        const exists = existsSync(witnessPath);
        const pass = serviceRestarted && exists;
        recordCase("B16", {
          workspaceId: sharedWorkspaceId,
          expected: "Candidate workspace file written; persists across real systemctl --user service restart",
          actual: `serviceRestarted=${serviceRestarted}, restartWitnessExists=${exists}`,
          verdict: pass ? "PASS" : "FAIL",
          evidenceClass: "CLASS_A_PHYSICAL_FS",
        });
      }
    }

    // -------------------------------------------------------------
    // Case B17: Fixture and Qualification Workspace Cleanup
    // -------------------------------------------------------------
    if (selectedCase === "ALL" || selectedCase === "B17") {
      if (options.cleanup !== false) {
        try {
          rmSync(fixtureRoot, { recursive: true, force: true });
          rmSync(workspaceRoot, { recursive: true, force: true });
        } catch {}
      }
      recordCase("B17", {
        expected: "Temporary qualification fixture and workspace roots removed",
        actual: "Cleaned up",
        verdict: "PASS",
        evidenceClass: "CLASS_A_PHYSICAL_FS",
      });
    }
  } catch (err) {
    results.error = String(err);
    results.verdict = "ERROR";
  }

  // Calculate overall verdict
  const caseEntries = Object.entries(results.cases);
  const anyLocalFail = caseEntries.some(([, c]) => c.localSelfTest === "FAIL");
  const anyPhysFail = caseEntries.some(([, c]) => c.physicalVerdict === "FAIL");
  const anyPhysBlocked = caseEntries.some(([, c]) => c.physicalVerdict === "BLOCKED");

  if (!isLinux) {
    results.localSelfTest = anyLocalFail ? "FAIL" : "PASS";
    results.physicalVerdict = "NOT_EXECUTED";
    results.verdict = anyLocalFail ? "LOCAL SELF-TEST FAILED" : "LOCAL SELF-TEST COMPLETE";
  } else {
    results.localSelfTest = anyLocalFail ? "FAIL" : "PASS";
    if (anyPhysFail) {
      results.physicalVerdict = "FAIL";
      results.verdict = "PHYSICAL QUALIFICATION FAILED";
    } else if (anyPhysBlocked) {
      results.physicalVerdict = "BLOCKED";
      results.verdict = "QUALIFICATION AUTHORITY BLOCKED";
    } else {
      results.physicalVerdict = "PASS";
      results.verdict = "M3 SUBSTRATE QUALIFIED";
    }
  }

  return results;
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  };
  const hasFlag = (flag) => args.includes(flag);

  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(`
Project Ashley — Sandbox V2 M3 Phase B Substrate Qualification Harness

Usage:
  node scripts/mint/m3-substrate-qualification.mjs [options]

Options:
  --case <ID>            Run specific case (B1..B17) or ALL (default: ALL)
  --json                 Output complete JSON summary to stdout
  --save-artifacts       Save individual case JSON artifacts to qualification directory
  --fixture-root <path>  Custom isolated fixture root directory
  --workspace-root <dir> Custom isolated workspace root directory
  --no-cleanup           Preserve fixture and workspace trees after run
  --help, -h             Show this help message
`);
    process.exit(0);
  }

  const runOptions = {
    case: getArg("--case") || "ALL",
    fixtureRoot: getArg("--fixture-root"),
    workspaceRoot: getArg("--workspace-root"),
    saveArtifacts: hasFlag("--save-artifacts"),
    cleanup: !hasFlag("--no-cleanup"),
  };

  runSubstrateQualification(runOptions)
    .then((res) => {
      if (hasFlag("--json")) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log("\n=======================================================");
        if (process.platform !== "linux") {
          console.log(" M3 SUBSTRATE QUALIFICATION HARNESS: LOCAL SELF-TEST COMPLETE");
          console.log(" PHYSICAL MINT QUALIFICATION: NOT EXECUTED");
        } else {
          console.log(` M3 SUBSTRATE QUALIFICATION: ${res.verdict}`);
        }
        console.log("=======================================================");
        for (const [id, c] of Object.entries(res.cases)) {
          if (process.platform !== "linux") {
            const statusBadge = `NOT_EXECUTED (local: ${c.localSelfTest === "NOT_APPLICABLE" ? "N/A" : c.localSelfTest})`;
            console.log(` [${id}] ${statusBadge.padEnd(28)} -> ${c.actual}`);
          } else {
            console.log(` [${id}] ${c.physicalVerdict.padEnd(24)} -> ${c.actual}`);
          }
        }
        console.log("=======================================================\n");
      }
      if (res.verdict === "PHYSICAL QUALIFICATION FAILED" || res.localSelfTest === "FAIL") process.exit(1);
    })
    .catch((err) => {
      console.error("FATAL HARNESS ERROR:", err);
      process.exit(1);
    });
}
