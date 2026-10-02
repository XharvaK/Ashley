/** Falsify paired artifact recovery, conflicts and exact-byte readback in portable temporary directories. */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const dirs: string[] = [];
afterEach(() => { for (const root of dirs.splice(0)) rmSync(root, { recursive: true, force: true }); });
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const module = await import("./artifact-pair.js").catch(() => null);
  expect(typeof module?.writeArtifactPair, "paired export mechanism exists").toBe("function");
  const destinationRoot = realpathSync(mkdtempSync(join(tmpdir(), "ashley-s0-pair-")));
  dirs.push(destinationRoot);
  const patch = Buffer.from("diff --git a/a b/a\n");
  const manifest = Buffer.from(JSON.stringify({ patchSha256: digest(patch), rationale: "authored", m4Receipt: { taskId: "actual-receipt" } }) + "\n");
  const request = { destinationRoot, changesetId: "cs_bound", patch, manifest };
  return { write: module!.writeArtifactPair, request, patchPath: join(destinationRoot, "cs_bound.patch"), manifestPath: join(destinationRoot, "cs_bound.manifest.json") };
}
describe("S0 paired export", () => {
  it("writes and witnesses both exact byte sequences, and repeats idempotently", async () => {
    const f = await fixture();
    expect(f.write(f.request)).toMatchObject({ ok: true, patchSha256: digest(f.request.patch), manifestSha256: digest(f.request.manifest) });
    expect(readFileSync(f.patchPath)).toEqual(f.request.patch);
    expect(readFileSync(f.manifestPath)).toEqual(f.request.manifest);
    expect(f.write(f.request)).toMatchObject({ ok: true });
  });
  it("completes an interrupted matching patch-only export without overwriting it", async () => {
    const f = await fixture();
    writeFileSync(f.patchPath, f.request.patch);
    expect(f.write(f.request)).toMatchObject({ ok: true });
    expect(readFileSync(f.patchPath)).toEqual(f.request.patch);
    expect(readFileSync(f.manifestPath)).toEqual(f.request.manifest);
  });
  it("refuses a conflicting manifest before creating a missing patch", async () => {
    const f = await fixture();
    writeFileSync(f.manifestPath, "other manifest");
    expect(f.write(f.request)).toMatchObject({ ok: false, error: "destination_conflict" });
    expect(existsSync(f.patchPath)).toBe(false);
    expect(readFileSync(f.manifestPath, "utf8")).toBe("other manifest");
  });
  it("refuses a conflicting patch before creating a missing manifest", async () => {
    const f = await fixture();
    writeFileSync(f.patchPath, "other patch");
    expect(f.write(f.request)).toMatchObject({ ok: false, error: "destination_conflict" });
    expect(existsSync(f.manifestPath)).toBe(false);
  });
});
