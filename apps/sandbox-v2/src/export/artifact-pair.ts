/** Export an exact patch/manifest pair with no-overwrite recovery and independent digest readback. */
import { createHash, randomUUID } from "node:crypto";
import { linkSync, lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function state(root: string, path: string): "missing" | "file" | "invalid" {
  try {
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(root) !== root || dirname(path) !== root) return "invalid";
    try {
      const stat = lstatSync(path);
      return !stat.isSymbolicLink() && stat.isFile() && realpathSync(path) === path ? "file" : "invalid";
    } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid"; }
  } catch { return "invalid"; }
}

export function writeArtifactPair(input: { destinationRoot: string; changesetId: string; patch: Buffer; manifest: Buffer }):
  | { ok: true; patchPath: string; manifestPath: string; patchSha256: string; manifestSha256: string }
  | { ok: false; error: string } {
  if (!/^cs_[A-Za-z0-9_-]+$/.test(input.changesetId)) return { ok: false, error: "destination_escape" };
  const artifacts = [
    { path: join(input.destinationRoot, `${input.changesetId}.patch`), bytes: input.patch, sha: digest(input.patch) },
    { path: join(input.destinationRoot, `${input.changesetId}.manifest.json`), bytes: input.manifest, sha: digest(input.manifest) },
  ];
  const temps: string[] = [];
  let anyPresent = false;
  try {
    // Check BOTH destinations before any new artifact is visible.
    for (const item of artifacts) {
      const observed = state(input.destinationRoot, item.path);
      if (observed === "invalid") return { ok: false, error: "destination_escape" };
      if (observed === "file") {
        if (digest(readFileSync(item.path)) !== item.sha) return { ok: false, error: "destination_conflict" };
        anyPresent = true;
      }
    }
    for (const item of artifacts) {
      const observed = state(input.destinationRoot, item.path);
      if (observed === "invalid") return { ok: false, error: anyPresent ? "export_pair_incomplete" : "destination_escape" };
      if (observed === "file") {
        if (digest(readFileSync(item.path)) !== item.sha) return { ok: false, error: "destination_conflict" };
        continue;
      }
      const temp = join(input.destinationRoot, `.export-${randomUUID()}.tmp`);
      temps.push(temp);
      writeFileSync(temp, item.bytes, { mode: 0o600, flag: "wx" });
      if (state(input.destinationRoot, item.path) === "invalid") return { ok: false, error: anyPresent ? "export_pair_incomplete" : "destination_escape" };
      try { linkSync(temp, item.path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || state(input.destinationRoot, item.path) !== "file"
          || digest(readFileSync(item.path)) !== item.sha) throw error;
      }
      anyPresent = true;
    }
    if (artifacts.some(item => state(input.destinationRoot, item.path) !== "file" || digest(readFileSync(item.path)) !== item.sha)) {
      return { ok: false, error: "witness_mismatch" };
    }
    return { ok: true, patchPath: artifacts[0]!.path, manifestPath: artifacts[1]!.path,
      patchSha256: artifacts[0]!.sha, manifestSha256: artifacts[1]!.sha };
  } catch { return { ok: false, error: anyPresent ? "export_pair_incomplete" : "destination_write_failed" }; }
  finally { for (const temp of temps) { try { unlinkSync(temp); } catch { /* retain the authoritative pair result */ } } }
}
