import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { observerError } from "./errors.js";

function canonicalPath(input: string): string {
  const absolute = resolve(input);
  let cursor = absolute;
  const missing: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw observerError("path_resolution_failed", `path_resolution_failed:${input}`);
    }
    missing.push(cursor.slice(parent.length + 1));
    cursor = parent;
  }
  let resolved = realpathSync.native(cursor);
  for (const component of missing.reverse()) resolved = join(resolved, component);
  return resolved;
}

function isInsideOrEqual(parent: string, candidate: string): boolean {
  const parentCanonical = canonicalPath(parent);
  const candidateCanonical = canonicalPath(candidate);
  const child = relative(parentCanonical, candidateCanonical);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

export function assertOutputRootSafe(outRoot: string, dataRoot: string): string {
  if (outRoot.trim() === "" || dataRoot.trim() === "") {
    throw observerError("path_invalid");
  }
  if (isInsideOrEqual(dataRoot, outRoot)) {
    throw observerError("output_inside_data_plane");
  }
  return resolve(outRoot);
}

export function assertPathContained(root: string, candidate: string): string {
  if (!isInsideOrEqual(root, candidate)) throw observerError("path_outside_root");
  return resolve(candidate);
}

export function ensureDirectory(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function canonicalPathForTest(input: string): string {
  return canonicalPath(input);
}

export function pathIsInside(parent: string, candidate: string): boolean {
  return isInsideOrEqual(parent, candidate);
}

export function assertExistingDirectory(path: string, code: string): string {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw observerError(code, `${code}:${path}`);
  }
  return resolve(path);
}
