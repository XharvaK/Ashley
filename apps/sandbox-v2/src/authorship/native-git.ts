/** Bind immutable sanitized bases and render byte-exact patches in a controller-owned Git store. */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { V2_LIMITS } from "../limits.js";

export type SourceGitIdentity = { baseCommit: string; sourceTree: string };
export type RecordedGitBase = SourceGitIdentity & {
  version: 1; workspaceId: string; projectId: string; sourceSnapshotId: string; sanitizedTree: string;
};
const oid = (value: unknown): value is string => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);

function environment(): NodeJS.ProcessEnv {
  // No inherited tokens, Git redirects, helpers, global configuration or credentials.
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG"]) {
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  return { ...result, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1" };
}

function git(args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv; maxBuffer?: number }): Buffer {
  const hooks = options.env?.GIT_DIR ? ["-c", `core.hooksPath=${join(options.env.GIT_DIR, "no-hooks")}`, "-c", "core.filemode=false"] : [];
  return execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.autocrlf=false", "-c", "protocol.allow=never", ...hooks, ...args], {
    cwd: options.cwd, env: options.env ?? environment(), timeout: V2_LIMITS.TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? V2_LIMITS.CHANGESET_MAX_PATCH_BYTES + 1,
    stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
}

export function readSourceGitIdentity(sourceRoot: string): SourceGitIdentity | null {
  try {
    const top = git(["rev-parse", "--show-toplevel"], { cwd: sourceRoot }).toString("utf8").trim();
    if (realpathSync(top) !== realpathSync(sourceRoot)) return null;
    if (git(["status", "--porcelain", "--untracked-files=normal"], { cwd: sourceRoot }).length !== 0) return null;
    const baseCommit = git(["rev-parse", "--verify", "HEAD^{commit}"], { cwd: sourceRoot }).toString("utf8").trim();
    const sourceTree = git(["rev-parse", "--verify", "HEAD^{tree}"], { cwd: sourceRoot }).toString("utf8").trim();
    return oid(baseCommit) && oid(sourceTree) ? { baseCommit, sourceTree } : null;
  } catch { return null; }
}

function storeEnvironment(workspaceRoot: string, treeRoot: string, index: string): NodeJS.ProcessEnv {
  return { ...environment(), GIT_DIR: join(workspaceRoot, "_base", "store.git"), GIT_WORK_TREE: treeRoot, GIT_INDEX_FILE: index };
}

function stageTree(workspaceRoot: string, treeRoot: string, index: string): string {
  const check = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error("candidate_file_type_forbidden");
      if (entry.isDirectory()) check(join(directory, entry.name));
    }
  };
  check(treeRoot);
  const env = storeEnvironment(workspaceRoot, treeRoot, index);
  git(["read-tree", "--empty"], { cwd: treeRoot, env });
  // Sanitization owns admitted files; candidate .gitignore cannot hide an admitted delta.
  git(["add", "--force", "--all", "--", "."], { cwd: treeRoot, env });
  return git(["write-tree"], { cwd: treeRoot, env }).toString("utf8").trim();
}

export function captureRecordedGitBase(input: {
  sourceRoot: string; sanitizedRoot: string; workspaceRoot: string;
  expectedSource: SourceGitIdentity | null; workspaceId: string; projectId: string; sourceSnapshotId: string;
}): RecordedGitBase | null {
  const current = readSourceGitIdentity(input.sourceRoot);
  if (!input.expectedSource || !current || JSON.stringify(current) !== JSON.stringify(input.expectedSource)) return null;
  const baseRoot = join(input.workspaceRoot, "_base");
  const treeRoot = join(baseRoot, "tree");
  const index = join(baseRoot, "base.index");
  try {
    mkdirSync(baseRoot, { recursive: true, mode: 0o700 });
    cpSync(input.sanitizedRoot, treeRoot, { recursive: true });
    const store = join(baseRoot, "store.git");
    git(["init", "--bare", "--quiet", store], { cwd: baseRoot });
    mkdirSync(join(store, "no-hooks"), { mode: 0o700 });
    git(["--git-dir", store, "config", "core.hooksPath", join(store, "no-hooks")], { cwd: baseRoot });
    // Override candidate attributes that could normalize bytes or invoke filters.
    writeFileSync(join(store, "info", "attributes"), "* -text -filter -ident -working-tree-encoding\n", { mode: 0o600 });
    const sanitizedTree = stageTree(input.workspaceRoot, treeRoot, index);
    const after = readSourceGitIdentity(input.sourceRoot);
    if (!oid(sanitizedTree) || !after || JSON.stringify(after) !== JSON.stringify(current)) return null;
    const record: RecordedGitBase = { ...current, version: 1, workspaceId: input.workspaceId,
      projectId: input.projectId, sourceSnapshotId: input.sourceSnapshotId, sanitizedTree };
    writeFileSync(join(baseRoot, "identity.json"), JSON.stringify(record), { mode: 0o600 });
    return record;
  } catch { return null; }
  finally { rmSync(index, { force: true }); }
}

export function validateRecordedGitBase(input: {
  sourceRoot: string; workspaceRoot: string; record: RecordedGitBase | undefined;
  workspaceId: string; projectId: string; sourceSnapshotId: string;
}): { ok: true; baseTreeRoot: string; record: RecordedGitBase } | { ok: false; error: string } {
  const record = input.record;
  if (!record) return { ok: false, error: "recorded_base_required" };
  try {
    const pinned = JSON.parse(readFileSync(join(input.workspaceRoot, "_base", "identity.json"), "utf8"));
    const keys = ["version", "baseCommit", "sourceTree", "sanitizedTree", "workspaceId", "projectId", "sourceSnapshotId"] as const;
    if (record.version !== 1 || !oid(record.baseCommit) || !oid(record.sourceTree) || !oid(record.sanitizedTree)
      || record.workspaceId !== input.workspaceId || record.projectId !== input.projectId || record.sourceSnapshotId !== input.sourceSnapshotId
      || keys.some(key => record[key] !== pinned[key])) return { ok: false, error: "recorded_base_mismatch" };
    const sourceTree = git(["rev-parse", "--verify", `${record.baseCommit}^{tree}`], { cwd: input.sourceRoot }).toString("utf8").trim();
    if (sourceTree !== record.sourceTree) return { ok: false, error: "recorded_base_mismatch" };
    const current = readSourceGitIdentity(input.sourceRoot);
    if (!current || current.baseCommit !== record.baseCommit || current.sourceTree !== record.sourceTree) return { ok: false, error: "recorded_base_stale" };
    const baseTreeRoot = join(input.workspaceRoot, "_base", "tree");
    const index = join(input.workspaceRoot, "_base", `validate-${randomBytes(8).toString("hex")}.index`);
    try {
      const env = storeEnvironment(input.workspaceRoot, baseTreeRoot, index);
      if (git(["cat-file", "-t", record.sanitizedTree], { cwd: baseTreeRoot, env }).toString("utf8").trim() !== "tree"
        || stageTree(input.workspaceRoot, baseTreeRoot, index) !== record.sanitizedTree) return { ok: false, error: "recorded_base_mismatch" };
    } finally { rmSync(index, { force: true }); }
    return { ok: true, baseTreeRoot, record };
  } catch { return { ok: false, error: "recorded_base_unreachable" }; }
}

export function renderNativeGitPatch(input: {
  workspaceRoot: string; candidateRoot: string; baseTree: string;
}): { patch: Buffer; candidateGitTree: string } {
  const index = join(input.workspaceRoot, "_base", `render-${randomBytes(8).toString("hex")}.index`);
  try {
    const candidateGitTree = stageTree(input.workspaceRoot, input.candidateRoot, index);
    const patch = git(["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", input.baseTree, "--", "."], {
      cwd: input.candidateRoot, env: storeEnvironment(input.workspaceRoot, input.candidateRoot, index),
    });
    if (!oid(candidateGitTree) || patch.length > V2_LIMITS.CHANGESET_MAX_PATCH_BYTES) throw new Error("changeset_too_large");
    return { patch, candidateGitTree };
  } finally { rmSync(index, { force: true }); }
}
