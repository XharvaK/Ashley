import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type SourceCleanliness = "clean" | "dirty_explicit_manifest" | "unknown";

export type GitIdentity = {
  baseCommit: string | null;
  sourceCleanliness: SourceCleanliness;
};

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
};

const ALLOWED_GIT_IDENTITY_ARGS: ReadonlyArray<readonly string[]> = [
  ["rev-parse", "HEAD"],
  ["status", "--porcelain"],
];

function isAllowedGitIdentityInvocation(args: readonly string[]): boolean {
  return ALLOWED_GIT_IDENTITY_ARGS.some(
    (allowed) => allowed.length === args.length && allowed.every((token, i) => token === args[i]),
  );
}

function git(args: string[], cwd: string): string | null {
  if (!isAllowedGitIdentityInvocation(args)) {
    return null;
  }
  try {
    const out = execFileSync("git", args, {
      cwd,
      env: GIT_ENV,
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return out.trim();
  } catch {
    return null;
  }
}

export function readParentGitIdentity(canonicalRoot: string): GitIdentity {
  if (!existsSync(join(canonicalRoot, ".git"))) {
    return { baseCommit: null, sourceCleanliness: "unknown" };
  }
  const head = git(["rev-parse", "HEAD"], canonicalRoot);
  const porcelain = git(["status", "--porcelain"], canonicalRoot);
  if (head === null || porcelain === null) {
    return { baseCommit: head && /^[0-9a-f]{7,64}$/i.test(head) ? head : null, sourceCleanliness: "unknown" };
  }
  return {
    baseCommit: /^[0-9a-f]{7,64}$/i.test(head) ? head : null,
    sourceCleanliness: porcelain.length === 0 ? "clean" : "dirty_explicit_manifest",
  };
}
