import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

// Shared by the executable M3 harness and its integrity tests. Keeping this
// small contract module dependency-light also lets Vitest load it natively on
// Windows without evaluating the full CLI dependency graph.
export const CANONICAL_WITNESS_BYTES = "m3-witness-ok";
export const CANONICAL_WITNESS_LENGTH = 13;
export const CANONICAL_WITNESS_SHA256 = "cf638cbb32331a0d99110697fb5f9ff790a11c15749bbc287a132bcc0bcc708e";

export function toCanonicalPosixRoot(p) {
  let norm = p.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(norm)) norm = norm.slice(2);
  if (!norm.startsWith("/")) norm = "/" + norm;
  return norm.replace(/\/+/g, "/");
}

/** Validate that a qualification path cannot be production state. */
export function assertSafePath(targetPath, description) {
  if (!targetPath || typeof targetPath !== "string") {
    throw new Error(`Invalid path provided for ${description}`);
  }
  const resolvedTarget = resolve(targetPath);
  const canonicalTarget = existsSync(resolvedTarget) ? realpathSync(resolvedTarget) : resolvedTarget;

  const home = homedir();
  const protectedLocations = [
    "/home/xarvak/project-ashley",
    join(home, ".composer-assistant", "project-roots.json"),
    join(home, ".composer-assistant", "conversations", "nuclear.db"),
    join(home, ".composer-assistant", "continuity.db"),
    join(home, ".composer-assistant", "index.db"),
    join(home, ".composer-assistant"),
  ];

  for (const prot of protectedLocations) {
    const resolvedProt = resolve(prot);
    const canonicalProt = existsSync(resolvedProt) ? realpathSync(resolvedProt) : resolvedProt;
    if (canonicalTarget === canonicalProt) {
      throw new Error(`ProductionPathViolation: ${description} (${targetPath}) directly matches protected production location (${prot})`);
    }
    const rel = relative(canonicalProt, canonicalTarget);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      throw new Error(`ProductionPathViolation: ${description} (${targetPath}) is contained within protected production location (${prot})`);
    }
  }
}

/** Independently verify the exact canonical witness bytes and digest. */
export function verifyCanonicalWitnessHash() {
  const buf = Buffer.from(CANONICAL_WITNESS_BYTES, "utf8");
  if (buf.length !== CANONICAL_WITNESS_LENGTH) {
    throw new Error(`Canonical witness length mismatch: expected ${CANONICAL_WITNESS_LENGTH}, got ${buf.length}`);
  }
  const hash = createHash("sha256").update(buf).digest("hex");
  if (hash !== CANONICAL_WITNESS_SHA256) {
    throw new Error(`Canonical witness hash mismatch: expected ${CANONICAL_WITNESS_SHA256}, got ${hash}`);
  }
  return { length: buf.length, sha256: hash };
}
