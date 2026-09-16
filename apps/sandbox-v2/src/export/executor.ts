/**
 * Sandbox V2 M7 patch_export kernel.
 *
 * PREPARE binds a sealed artifact and operator destination.
 * REVALIDATE confirms hashes, grants, and that the destination is not the
 * live project root.
 * COMMIT copies bytes once, then read-back witnesses the digest.
 *
 * This is not apply, merge, Git, deploy, or restart.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { isCanonicalForm, isPatchExportAllowed, isWithin } from "@composer-assistant/sandbox-policy";
import type { V2ProjectReadRegistry } from "../registry.js";
import type { SandboxV2PatchExportRequest, SandboxV2Result } from "../v2-types.js";

export type PatchExportExecutorOptions = {
  registry: V2ProjectReadRegistry;
  clock?: { nowMs(): number };
};

function nowMs(clock?: { nowMs(): number }): number {
  return clock ? clock.nowMs() : Date.now();
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function destinationState(
  destRoot: string,
  destPath: string,
): { ok: true; exists: boolean } | { ok: false } {
  try {
    const rootStat = lstatSync(destRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return { ok: false };
    const resolvedRoot = realpathSync(destRoot);
    if (resolvedRoot !== destRoot || dirname(destPath) !== resolvedRoot) return { ok: false };

    let destinationStat;
    try {
      destinationStat = lstatSync(destPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, exists: false };
      return { ok: false };
    }
    if (destinationStat.isSymbolicLink() || !destinationStat.isFile()) return { ok: false };
    const resolvedDestination = realpathSync(destPath);
    const resolvedRelative = relative(resolvedRoot, resolvedDestination);
    if (dirname(resolvedDestination) !== resolvedRoot
      || resolvedDestination === resolvedRoot
      || resolvedRelative.startsWith("..")
      || isAbsolute(resolvedRelative)) {
      return { ok: false };
    }
    return { ok: true, exists: true };
  } catch {
    return { ok: false };
  }
}

export function validatePatchExportRequest(
  value: unknown,
): { ok: true; request: SandboxV2PatchExportRequest } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "invalid-request" };
  }
  const obj = value as Record<string, unknown>;
  if (obj.version !== 2) return { ok: false, error: "invalid-request" };
  if (obj.operation !== "patch_export") return { ok: false, error: "invalid-request" };
  if (typeof obj.projectId !== "string" || obj.projectId.length < 1) {
    return { ok: false, error: "missing_project" };
  }
  if (typeof obj.changesetId !== "string" || !obj.changesetId.startsWith("cs_")) {
    return { ok: false, error: "missing_changeset" };
  }
  if (typeof obj.artifactRef !== "string" || !isCanonicalForm(obj.artifactRef)) {
    return { ok: false, error: "artifact_ref_invalid" };
  }
  if (typeof obj.expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(obj.expectedSha256)) {
    return { ok: false, error: "expected_digest_invalid" };
  }
  if (typeof obj.destinationRoot !== "string" || !isCanonicalForm(obj.destinationRoot)) {
    return { ok: false, error: "destination_invalid" };
  }
  return {
    ok: true,
    request: {
      version: 2,
      operation: "patch_export",
      projectId: obj.projectId,
      changesetId: obj.changesetId,
      artifactRef: obj.artifactRef,
      expectedSha256: obj.expectedSha256,
      destinationRoot: obj.destinationRoot,
    },
  };
}

export function executePatchExport(
  request: unknown,
  options: PatchExportExecutorOptions,
): SandboxV2Result {
  const executedAtMs = nowMs(options.clock);
  const fail = (error: string): SandboxV2Result => ({
    outcome: "failed",
    operation: "patch_export",
    error,
    executedAtMs,
  });

  const parsed = validatePatchExportRequest(request);
  if (!parsed.ok) return fail(parsed.error);

  const resolved = options.registry.resolveReadRoot(parsed.request.projectId);
  if (!resolved.ok) return fail(resolved.error);
  if (!isPatchExportAllowed(resolved.entry)) return fail("patch_export_not_allowed");
  const destRoot = resolved.entry.exportDestinationCanonicalRoot;
  if (!destRoot) return fail("patch_export_not_allowed");
  if (destRoot !== parsed.request.destinationRoot) return fail("destination_mismatch");
  if (destRoot === resolved.entry.canonicalRoot) return fail("destination_is_live_root");

  if (!existsSync(parsed.request.artifactRef)) return fail("artifact_missing");
  const sourceDigest = sha256File(parsed.request.artifactRef);
  if (sourceDigest !== parsed.request.expectedSha256) return fail("artifact_digest_mismatch");

  const destName = `${parsed.request.changesetId}.patch`;
  const destPath = `${destRoot}/${destName}`;
  if (!isCanonicalForm(destPath) || !isWithin(destRoot, destPath)) {
    return fail("destination_escape");
  }

  const initialDestination = destinationState(destRoot, destPath);
  if (!initialDestination.ok) return fail("destination_escape");

  if (initialDestination.exists) {
    const existing = sha256File(destPath);
    if (existing !== parsed.request.expectedSha256) return fail("destination_conflict");
    return succeeded(parsed.request, destPath, destName, existing, executedAtMs, readFileSync(destPath).byteLength);
  }

  const bytes = readFileSync(parsed.request.artifactRef);
  const tempPath = join(destRoot, `.${destName}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, bytes, { mode: 0o600, flag: "wx" });
    const beforeRename = destinationState(destRoot, destPath);
    if (!beforeRename.ok) return fail("destination_escape");
    if (beforeRename.exists) return fail("destination_conflict");
    renameSync(tempPath, destPath);
  } catch {
    return fail("destination_write_failed");
  } finally {
    try { rmSync(tempPath, { force: true }); } catch { /* preserve export result */ }
  }

  const afterRename = destinationState(destRoot, destPath);
  if (!afterRename.ok || !afterRename.exists) return fail("destination_escape");
  const witnessed = sha256File(destPath);
  if (witnessed !== parsed.request.expectedSha256) {
    return fail("witness_mismatch");
  }

  return succeeded(parsed.request, destPath, destName, witnessed, executedAtMs, bytes.byteLength);
}

function succeeded(
  request: SandboxV2PatchExportRequest,
  destPath: string,
  destName: string,
  witnessedSha256: string,
  executedAtMs: number,
  bytesWritten: number,
): SandboxV2Result {
  return {
    outcome: "succeeded",
    operation: "patch_export",
    executedAtMs,
    result: {
      kind: "patch_export",
      projectId: request.projectId,
      changesetId: request.changesetId,
      destinationRelativeName: destName,
      artifactRef: request.artifactRef,
      destinationPath: destPath,
      patchSha256: request.expectedSha256,
      witnessedSha256,
      bytesWritten,
      liveUnwritten: true,
      gitUnwritten: true,
      applied: false,
      protocolState: "admitted",
      witnessState: "digest_readback",
      completedAtMs: executedAtMs,
    },
  };
}
