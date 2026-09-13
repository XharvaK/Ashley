import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type TreeFileRecord = {
  path: string;
  sha256: string;
  bytes: number;
  utf8: string | null;
};

function posixRel(treeRoot: string, filePath: string): string {
  return relative(treeRoot, filePath).split(sep).join("/");
}

function walkFiles(treeRoot: string, current: string, acc: string[]): void {
  if (!existsSync(current)) return;
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkFiles(treeRoot, fullPath, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    acc.push(fullPath);
  }
}

function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    const decoded = bytes.toString("utf8");
    return Buffer.from(decoded, "utf8").equals(bytes);
  } catch {
    return false;
  }
}

export function collectTreeRecords(treeRoot: string): Map<string, TreeFileRecord> {
  const files: string[] = [];
  walkFiles(treeRoot, treeRoot, files);
  const records = new Map<string, TreeFileRecord>();
  for (const filePath of files) {
    const rel = posixRel(treeRoot, filePath);
    if (rel.length === 0 || rel.startsWith("..")) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(filePath);
      statSync(filePath);
    } catch {
      continue;
    }
    records.set(rel, {
      path: rel,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      utf8: isUtf8Text(bytes) ? bytes.toString("utf8") : null,
    });
  }
  return records;
}

export function candidateContainsGitMetadata(treeRoot: string): boolean {
  if (existsSync(join(treeRoot, ".git"))) {
    return true;
  }
  for (const path of collectTreeRecords(treeRoot).keys()) {
    if (path === ".git" || path === ".git/" || path.startsWith(".git/")) {
      return true;
    }
  }
  return false;
}
