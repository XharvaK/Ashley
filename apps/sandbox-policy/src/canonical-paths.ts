/**
 * Pure canonical-path contracts for sandbox policy evaluation.
 *
 * Canonical inputs are deterministic: POSIX separators, absolute, no `.` or
 * `..` segments, no duplicate separators, no trailing separator except the
 * filesystem root, and no NUL bytes. Actual `realpath` filesystem resolution
 * is a broker-integration concern and is deliberately not performed here;
 * callers provide canonical inputs (or an injected canonicalizer), and
 * non-canonical inputs fail closed.
 */

export type PathErrorReason =
  | "path_empty"
  | "path_invalid_nul"
  | "path_not_absolute"
  | "path_escape_above_root"
  | "path_not_within_root"
  | "path_malformed";

export type PathResult =
  | { ok: true; value: string }
  | { ok: false; reason: PathErrorReason };

const NUL = "\0";

function normalizeSeparators(input: string): string {
  return input.replace(/\\/g, "/");
}

/**
 * Returns the deterministic canonical form of an absolute POSIX path.
 * Resolves `.` and `..` lexically; `..` above the filesystem root is an
 * error. Never touches the filesystem.
 */
export function canonicalizePath(input: string): PathResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, reason: "path_empty" };
  }
  if (input.includes(NUL)) {
    return { ok: false, reason: "path_invalid_nul" };
  }
  const posix = normalizeSeparators(input);
  if (!posix.startsWith("/")) {
    return { ok: false, reason: "path_not_absolute" };
  }
  const segments: string[] = [];
  for (const raw of posix.split("/")) {
    const segment = raw;
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        return { ok: false, reason: "path_escape_above_root" };
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return { ok: true, value: segments.length === 0 ? "/" : `/${segments.join("/")}` };
}

/**
 * Resolves a candidate path against a canonical root and rejects escapes.
 * Absolute candidates must already be within the root; relative candidates
 * are resolved against it. Fail closed on malformed inputs.
 */
export function canonicalizeWithinRoot(
  root: string,
  candidate: string,
): PathResult {
  const rootResult = canonicalizePath(root);
  if (!rootResult.ok) {
    return { ok: false, reason: rootResult.reason };
  }
  if (typeof candidate !== "string" || candidate.length === 0) {
    return { ok: false, reason: "path_empty" };
  }
  const posix = normalizeSeparators(candidate);
  if (posix.startsWith("/")) {
    const candidateResult = canonicalizePath(posix);
    if (!candidateResult.ok) {
      return { ok: false, reason: candidateResult.reason };
    }
    if (!isWithin(rootResult.value, candidateResult.value)) {
      return { ok: false, reason: "path_not_within_root" };
    }
    return { ok: true, value: candidateResult.value };
  }
  const joined = canonicalizePath(`${rootResult.value}/${posix}`);
  if (!joined.ok) {
    return joined.reason === "path_escape_above_root"
      ? { ok: false, reason: "path_escape_above_root" }
      : { ok: false, reason: "path_malformed" };
  }
  if (!isWithin(rootResult.value, joined.value)) {
    return { ok: false, reason: "path_not_within_root" };
  }
  return { ok: true, value: joined.value };
}

/** True when the path is already in canonical form. */
export function isCanonicalForm(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  const canonical = canonicalizePath(path);
  return canonical.ok && canonical.value === path;
}

function segments(path: string): string[] {
  return path === "/" ? [] : path.split("/").filter((s) => s !== "");
}

/**
 * Segmented containment: root equality returns true, and containment is
 * decided segment-by-segment so sibling prefixes never match
 * (`/a/ashley-sandbox` is not within `/a/ashley-sandbox-work`). Non-canonical
 * inputs fail closed.
 */
export function isWithin(root: string, target: string): boolean {
  if (!isCanonicalForm(root) || !isCanonicalForm(target)) return false;
  const rootSegments = segments(root);
  const targetSegments = segments(target);
  if (rootSegments.length === 0) return true;
  if (targetSegments.length < rootSegments.length) return false;
  for (let i = 0; i < rootSegments.length; i += 1) {
    if (rootSegments[i] !== targetSegments[i]) return false;
  }
  return true;
}

/** True when the target is within any of the given canonical roots. */
export function isWithinAny(roots: readonly string[], target: string): boolean {
  return roots.some((root) => isWithin(root, target));
}
