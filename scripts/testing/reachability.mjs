// Static reachability of agent-service source from its production entry points.
// Follows relative static and literal dynamic imports; test files and the
// declared allowlist (scripts/testing/reachability-allowlist.json) are exempt.
//
//   node scripts/testing/reachability.mjs            report, exit 1 on unlisted dead files
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = path.join(repo, "apps", "agent-service", "src");
const ENTRIES = ["index.ts", "isolated-index.ts"];

const posix = (f) => f.split(path.sep).join("/");
const isTest = (rel) =>
  /\.test\.ts$/.test(rel) || rel.includes("/__tests__/") || rel.includes("test-support");
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function listSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSources(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function resolveImport(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function scanReachability() {
  const reached = new Set();
  const stack = ENTRIES.map((entry) => path.join(src, entry));
  while (stack.length > 0) {
    const file = stack.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT_RE)) {
      const target = resolveImport(file, match[1] ?? match[2] ?? match[3]);
      if (target && !reached.has(target)) stack.push(target);
    }
  }
  const allowlist = JSON.parse(
    fs.readFileSync(path.join(repo, "scripts", "testing", "reachability-allowlist.json"), "utf8"),
  );
  const allowed = new Set(Object.keys(allowlist.files));
  const unreachable = listSources(src)
    .map((file) => ({ file, rel: posix(path.relative(src, file)) }))
    .filter(({ file, rel }) => !isTest(rel) && !reached.has(file))
    .map(({ rel }) => rel)
    .sort();
  return {
    unreachable,
    unlisted: unreachable.filter((rel) => !allowed.has(rel)),
    staleAllowlist: [...allowed].filter((rel) => !unreachable.includes(rel)).sort(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = scanReachability();
  console.log(`unreachable non-test files: ${result.unreachable.length} (${result.unlisted.length} not allowlisted)`);
  for (const rel of result.unlisted) console.log(`  DEAD ${rel}`);
  for (const rel of result.staleAllowlist) console.log(`  STALE-ALLOWLIST ${rel}`);
  process.exit(result.unlisted.length > 0 ? 1 : 0);
}
