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
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isCanonicalForm, isPatchExportAllowed, isWithin } from "@composer-assistant/sandbox-policy";
import type { V2ProjectReadRegistry } from "../registry.js";
import type { SandboxV2PatchExportRequest, SandboxV2Result } from "../v2-types.js";
import { writeArtifactPair } from "./artifact-pair.js";
import { V2_LIMITS } from "../limits.js";
import { scanAuthorshipText } from "../authorship/secret-scan.js";

export type PatchExportExecutorOptions = {
  registry: V2ProjectReadRegistry;
  clock?: { nowMs(): number };
};

function nowMs(clock?: { nowMs(): number }): number {
  return clock ? clock.nowMs() : Date.now();
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
  if (typeof obj.manifestUtf8 !== "string" || Buffer.byteLength(obj.manifestUtf8) > V2_LIMITS.REQUEST_MAX_BYTES
    || typeof obj.expectedManifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(obj.expectedManifestSha256)) return { ok: false, error: "export_manifest_required" };
  if (createHash("sha256").update(obj.manifestUtf8, "utf8").digest("hex") !== obj.expectedManifestSha256) return { ok: false, error: "manifest_digest_mismatch" };
  try {
    const m = JSON.parse(obj.manifestUtf8);
    if (m.version !== 1 || m.projectId !== obj.projectId || m.changesetId !== obj.changesetId || m.patchSha256 !== obj.expectedSha256
      || ![m.baseCommit, m.baseTree, m.sanitizedBaseTree, m.candidateTree].every(value => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))
      || typeof m.rationale !== "string" || !m.rationale.trim() || m.rationale.length > 4000
      || !Array.isArray(m.frictionRefs) || m.frictionRefs.length > 8 || !m.frictionRefs.every((ref: unknown) => typeof ref === "string" && ref.startsWith("friction:") && ref.length > 9)
      || m.m4Receipt?.outcome !== "succeeded" || m.m4Receipt?.verificationOutcome !== "verified_success"
      || m.m4Receipt?.candidateTreeHash !== m.candidateContentHash || typeof m.candidateContentHash !== "string" || !/^[a-f0-9]{64}$/.test(m.candidateContentHash)
      || typeof m.m4Receipt?.taskId !== "string" || !m.m4Receipt.taskId || typeof m.m4Receipt?.workspaceId !== "string" || !m.m4Receipt.workspaceId) {
      return { ok: false, error: "manifest_binding_invalid" };
    }
    if (scanAuthorshipText(obj.manifestUtf8).hit) return { ok: false, error: "secret_detected" };
  } catch { return { ok: false, error: "manifest_binding_invalid" }; }
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
      manifestUtf8: obj.manifestUtf8,
      expectedManifestSha256: obj.expectedManifestSha256,
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
  const bytes = readFileSync(parsed.request.artifactRef);
  const sourceDigest = createHash("sha256").update(bytes).digest("hex");
  if (sourceDigest !== parsed.request.expectedSha256) return fail("artifact_digest_mismatch");

  const destName = `${parsed.request.changesetId}.patch`;
  const destPath = `${destRoot}/${destName}`;
  if (!isCanonicalForm(destPath) || !isWithin(destRoot, destPath)) {
    return fail("destination_escape");
  }

  const pair = writeArtifactPair({ destinationRoot: destRoot, changesetId: parsed.request.changesetId,
    patch: bytes, manifest: Buffer.from(parsed.request.manifestUtf8, "utf8") });
  if (!pair.ok) return fail(pair.error);
  return succeeded(parsed.request, destPath, destName, pair.patchSha256, executedAtMs, bytes.byteLength, pair.manifestPath, pair.manifestSha256);
}

function succeeded(
  request: SandboxV2PatchExportRequest,
  destPath: string,
  destName: string,
  witnessedSha256: string,
  executedAtMs: number,
  bytesWritten: number,
  manifestPath: string,
  manifestSha256: string,
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
      manifestDestinationPath: manifestPath,
      manifestSha256: request.expectedManifestSha256,
      witnessedManifestSha256: manifestSha256,
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
