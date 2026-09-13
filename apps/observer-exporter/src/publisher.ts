import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fieldDayWindow } from "./field-day.js";
import { observerError } from "./errors.js";
import {
  assertExistingDirectory,
  assertPathContained,
  canonicalPathForTest,
  pathIsInside,
} from "./path-safety.js";
import {
  assertNoAshleyControlCredentials,
  assertNoAshleyProcessControlCredentials,
} from "./security.js";
import type {
  ArtifactType,
  PublishArtifact,
  PublishManifest,
  PublishOptions,
  PublishResult,
} from "./types.js";

export type { PublishOptions } from "./types.js";

const ARTIFACT_ROOTS: Record<ArtifactType, string> = {
  transcript: "10 Daily Transcripts",
  analysis: "20 Daily Analyses",
  attestation: "30 Owner Attestations",
  finding: "40 Findings",
  longitudinal: "50 Longitudinal",
  post_cutover: "60 Post-Cutover",
};

function gitOutput(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "git_failed";
    throw observerError("git_command_failed", `git_command_failed:${args[0] ?? "unknown"}:${detail}`);
  }
}

function gitFastForward(cwd: string, remote: string, branch: string): void {
  try {
    execFileSync("git", ["merge", "--ff-only", `${remote}/${branch}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "diverged";
    throw observerError("fast_forward_required", `fast_forward_required:${detail}`);
  }
}

function ensureClean(cwd: string): void {
  if (gitOutput(cwd, ["status", "--porcelain", "--untracked-files=all"]) !== "") {
    throw observerError("worktree_dirty");
  }
}

function safeIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value)) {
    throw observerError(`${name}_invalid`);
  }
  return value;
}

function readManifest(artifactsRoot: string): PublishManifest {
  const path = join(artifactsRoot, "artifacts.json");
  if (!existsSync(path) || !lstatSync(path).isFile()) throw observerError("artifact_manifest_missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw observerError("artifact_manifest_invalid");
  }
  if (typeof parsed !== "object" || parsed === null) throw observerError("artifact_manifest_invalid");
  const manifest = parsed as Partial<PublishManifest>;
  if (
    typeof manifest.field_day !== "string" ||
    typeof manifest.bundle_id !== "string" ||
    typeof manifest.observer_pass_id !== "string" ||
    !Array.isArray(manifest.artifacts)
  ) {
    throw observerError("artifact_manifest_invalid");
  }
  return manifest as PublishManifest;
}

function validateTarget(type: ArtifactType, target: string, fieldDay: string): string {
  if (target.includes("\0")) throw observerError("artifact_target_invalid");
  const normalized = target.replaceAll("\\", "/");
  if (isAbsolute(target) || normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) {
    throw observerError("artifact_target_invalid");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw observerError("artifact_target_invalid");
  }
  const root = ARTIFACT_ROOTS[type];
  if (!root || parts[0] !== root || parts.length < 2 || !normalized.toLowerCase().endsWith(".md")) {
    throw observerError("artifact_target_invalid");
  }
  if (type === "transcript" || type === "analysis") {
    const escapedDay = fieldDay.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (!new RegExp(`^${escapedDay}(?:\\.rev-[A-Za-z0-9._:-]+)?\\.md$`, "u").test(parts[1]) || parts.length > 2) {
      throw observerError("artifact_target_invalid");
    }
  }
  return normalized;
}

function loadWrites(options: PublishOptions, manifest: PublishManifest): Array<{ target: string; content: string }> {
  if (manifest.field_day !== options.fieldDay || manifest.bundle_id !== options.bundleId || manifest.observer_pass_id !== options.observerPassId) {
    throw observerError("artifact_identity_mismatch");
  }
  const seen = new Set<string>();
  return manifest.artifacts.map((artifact: PublishArtifact) => {
    if (!artifact || typeof artifact !== "object" || typeof artifact.type !== "string" || !ARTIFACT_ROOTS[artifact.type as ArtifactType] || typeof artifact.source !== "string" || typeof artifact.target !== "string") {
      throw observerError("artifact_manifest_invalid");
    }
    const target = validateTarget(artifact.type, artifact.target, options.fieldDay);
    if (seen.has(target)) throw observerError("artifact_target_duplicate");
    seen.add(target);
    const source = assertPathContained(options.artifactsRoot, join(options.artifactsRoot, artifact.source));
    if (!existsSync(source) || !lstatSync(source).isFile()) throw observerError("artifact_source_missing");
    return { target, content: readFileSync(source, "utf8") };
  });
}

function writeFailureRecord(artifactsRoot: string, error: unknown): void {
  try {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "publish_failed";
    writeFileSync(
      join(artifactsRoot, ".field-lab-publish-failure.json"),
      `${JSON.stringify({ code, recorded_at: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // The structured error remains the primary result if the external record cannot be written.
  }
}

export function assertPublisherEnvironmentSafe(environment: Record<string, string | undefined>): void {
  assertNoAshleyControlCredentials(environment);
}

export async function publishFieldLabArtifacts(options: PublishOptions): Promise<PublishResult> {
  const artifactsRoot = assertExistingDirectory(options.artifactsRoot, "artifacts_root_missing");
  const worktree = assertExistingDirectory(options.fieldLabWorktree, "field_lab_missing");
  if (pathIsInside(worktree, artifactsRoot) || pathIsInside(artifactsRoot, worktree)) {
    throw observerError("artifacts_worktree_overlap");
  }
  const fieldDay = fieldDayWindow(options.fieldDay).fieldDay;
  const bundleId = safeIdentifier(options.bundleId, "bundle_id");
  const observerPassId = safeIdentifier(options.observerPassId, "observer_pass_id");
  const remote = safeIdentifier(options.remote ?? "origin", "remote");
  const branch = safeIdentifier(options.branch ?? "main", "branch");
  try {
    if (options.environment) assertPublisherEnvironmentSafe(options.environment);
    else assertNoAshleyProcessControlCredentials();
    const manifest = readManifest(artifactsRoot);
    const writes = loadWrites({ ...options, fieldDay, bundleId, observerPassId, remote, branch }, manifest);
    const topLevel = canonicalPathForTest(gitOutput(worktree, ["rev-parse", "--show-toplevel"]));
    if (topLevel !== canonicalPathForTest(worktree)) throw observerError("field_lab_root_mismatch");
    if (gitOutput(worktree, ["branch", "--show-current"]) !== branch) throw observerError("field_lab_branch_mismatch");
    gitOutput(worktree, ["fetch", "--prune", remote]);
    ensureClean(worktree);
    gitFastForward(worktree, remote, branch);
    ensureClean(worktree);
    const targets: string[] = [];
    const changed: Array<{ target: string; content: string }> = [];
    const commitMessage = `observer(field-day ${fieldDay}): publish ${observerPassId} ${bundleId}`;
    const priorMessages = gitOutput(worktree, ["log", "--all", "--format=%s", "-n", "1000"]).split(/\r?\n/u);
    const alreadyPersisted = priorMessages.includes(commitMessage);
    for (const write of writes) {
      const absolute = assertPathContained(worktree, join(worktree, ...write.target.split("/")));
      targets.push(write.target);
      if (existsSync(absolute)) {
        if (!lstatSync(absolute).isFile()) throw observerError("artifact_target_invalid");
        if (readFileSync(absolute, "utf8") !== write.content) throw observerError("artifact_target_exists_conflict");
      } else {
        changed.push(write);
      }
    }
    if (alreadyPersisted && changed.length > 0) throw observerError("duplicate_identity_conflict");
    if (changed.length === 0) return { status: "noop", commit: null, targets };
    for (const write of changed) {
      const absolute = assertPathContained(worktree, join(worktree, ...write.target.split("/")));
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, write.content, "utf8");
    }
    gitOutput(worktree, ["add", "--", ...changed.map((write) => write.target)]);
    const staged = gitOutput(worktree, ["diff", "--cached", "--name-only"]).split(/\r?\n/u).filter(Boolean).sort();
    const expected = changed.map((write) => write.target).sort();
    if (JSON.stringify(staged) !== JSON.stringify(expected)) throw observerError("staged_scope_invalid");
    gitOutput(worktree, ["commit", "-m", commitMessage]);
    const commit = gitOutput(worktree, ["rev-parse", "HEAD"]);
    gitOutput(worktree, ["fetch", "--prune", remote]);
    ensureClean(worktree);
    gitFastForward(worktree, remote, branch);
    ensureClean(worktree);
    gitOutput(worktree, ["push", remote, `HEAD:${branch}`]);
    return { status: "published", commit, targets };
  } catch (error) {
    writeFailureRecord(artifactsRoot, error);
    throw error;
  }
}

export function publisherImplementationSource(): string {
  return readFileSync(fileURLToPath(import.meta.url), "utf8");
}
