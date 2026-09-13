import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishFieldLabArtifacts,
  type PublishOptions,
} from "./publisher.js";
import { git, removeTemp, tempDir } from "../../../test/observer-support.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) removeTemp(path);
});

function writeArtifacts(
  root: string,
  input: {
    fieldDay?: string;
    bundleId?: string;
    observerPassId?: string;
    target?: string;
    content?: string;
  } = {},
): void {
  const fieldDay = input.fieldDay ?? "2026-08-26";
  const bundleId = input.bundleId ?? "bundle-1";
  const observerPassId = input.observerPassId ?? "pass-1";
  writeFileSync(
    join(root, "analysis.md"),
    input.content ?? `---\nbundle_id: ${bundleId}\n---\nAnalysis for ${fieldDay}.\n`,
    "utf8",
  );
  writeFileSync(
    join(root, "artifacts.json"),
    JSON.stringify({
      field_day: fieldDay,
      bundle_id: bundleId,
      observer_pass_id: observerPassId,
      artifacts: [
        {
          type: "analysis",
          source: "analysis.md",
          target: input.target ?? `20 Daily Analyses/${fieldDay}.md`,
        },
      ],
    }),
    "utf8",
  );
}

function makeGitLab(): { artifacts: string; worktree: string; remote: string } {
  const root = tempDir("observer-publisher-");
  temporaryPaths.push(root);
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const worktree = join(root, "field-lab");
  const artifacts = join(root, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  git(root, ["init", "--bare", "--initial-branch=main", remote]);
  git(root, ["init", "--initial-branch=main", seed]);
  git(seed, ["config", "user.name", "Test Owner"]);
  git(seed, ["config", "user.email", "owner@example.test"]);
  writeFileSync(join(seed, "README.md"), "Field Lab\n", "utf8");
  git(seed, ["add", "README.md"]);
  git(seed, ["commit", "-m", "initial"]);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "origin", "main"]);
  execFileSync("git", ["clone", remote, worktree], { stdio: "ignore" });
  git(worktree, ["config", "user.name", "Observer Writer"]);
  git(worktree, ["config", "user.email", "observer@example.test"]);
  return { artifacts, worktree, remote };
}

function publishOptions(
  paths: ReturnType<typeof makeGitLab>,
  overrides: Partial<PublishOptions> = {},
): PublishOptions {
  return {
    artifactsRoot: paths.artifacts,
    fieldLabWorktree: paths.worktree,
    fieldDay: "2026-08-26",
    bundleId: "bundle-1",
    observerPassId: "pass-1",
    environment: {},
    ...overrides,
  };
}

describe("bounded Field Lab publisher", () => {
  it("performs a clean fast-forward publication and a second no-op", async () => {
    const paths = makeGitLab();
    writeArtifacts(paths.artifacts);
    const first = await publishFieldLabArtifacts(publishOptions(paths));
    expect(first.status).toBe("published");
    expect(readFileSync(join(paths.worktree, "20 Daily Analyses", "2026-08-26.md"), "utf8")).toContain("bundle-1");
    const second = await publishFieldLabArtifacts(publishOptions(paths));
    expect(second.status).toBe("noop");
    expect(git(paths.worktree, ["log", "--format=%s", "origin/main..HEAD"])).toBe("");
  });

  it("fails closed on a diverged owner commit and preserves the owner file", async () => {
    const paths = makeGitLab();
    writeArtifacts(paths.artifacts);
    await publishFieldLabArtifacts(publishOptions(paths));

    writeFileSync(join(paths.worktree, "20 Daily Analyses", "2026-08-26.md"), "owner-local-edit\n", "utf8");
    git(paths.worktree, ["add", "20 Daily Analyses/2026-08-26.md"]);
    git(paths.worktree, ["commit", "-m", "owner local edit"]);

    const ownerClone = join(paths.worktree, "..", "owner-clone");
    execFileSync("git", ["clone", paths.remote, ownerClone], { stdio: "ignore" });
    git(ownerClone, ["config", "user.name", "Other Owner"]);
    git(ownerClone, ["config", "user.email", "other@example.test"]);
    writeFileSync(join(ownerClone, "README.md"), "owner-remote-edit\n", "utf8");
    git(ownerClone, ["add", "README.md"]);
    git(ownerClone, ["commit", "-m", "owner remote edit"]);
    git(ownerClone, ["push", "origin", "main"]);

    await expect(publishFieldLabArtifacts(publishOptions(paths))).rejects.toThrow(/fast_forward_required|diverged/);
    expect(readFileSync(join(paths.worktree, "20 Daily Analyses", "2026-08-26.md"), "utf8")).toBe("owner-local-edit\n");
  });

  it("publishes a late revision under a new declared filename", async () => {
    const paths = makeGitLab();
    writeArtifacts(paths.artifacts);
    await publishFieldLabArtifacts(publishOptions(paths));
    writeArtifacts(paths.artifacts, {
      bundleId: "bundle-2",
      observerPassId: "pass-2",
      target: "20 Daily Analyses/2026-08-26.rev-2.md",
      content: "revision\n",
    });
    const result = await publishFieldLabArtifacts(
      publishOptions(paths, { bundleId: "bundle-2", observerPassId: "pass-2" }),
    );
    expect(result.status).toBe("published");
    expect(readFileSync(join(paths.worktree, "20 Daily Analyses", "2026-08-26.rev-2.md"), "utf8")).toBe("revision\n");
  });

  it("does not create a second target for an already persisted identity", async () => {
    const paths = makeGitLab();
    writeArtifacts(paths.artifacts);
    await publishFieldLabArtifacts(publishOptions(paths));
    writeArtifacts(paths.artifacts, { target: "20 Daily Analyses/2026-08-26.rev-2.md" });
    await expect(publishFieldLabArtifacts(publishOptions(paths))).rejects.toThrow(/duplicate_identity_conflict/);
  });

  it("rejects traversal and control credentials before any Field Lab write", async () => {
    const paths = makeGitLab();
    writeArtifacts(paths.artifacts, { target: "20 Daily Analyses/../90 System/evil.md" });
    await expect(publishFieldLabArtifacts(publishOptions(paths))).rejects.toThrow(/artifact_target_invalid/);
    writeArtifacts(paths.artifacts);
    await expect(
      publishFieldLabArtifacts(
        publishOptions(paths, { environment: { DISCORD_BOT_TOKEN: "secret" } }),
      ),
    ).rejects.toThrow(/control_credential_present/);
    expect(readFileSync(join(paths.worktree, "README.md"), "utf8").replaceAll("\r\n", "\n")).toBe("Field Lab\n");
  });

  it("does not embed force flags in the Git publisher", async () => {
    const { publisherImplementationSource } = await import("./publisher.js");
    expect(publisherImplementationSource()).not.toMatch(/--force|force-with-lease|reset --hard|checkout --(?:ours|theirs)/);
  });
});
