#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_ORDER = [
  "sandbox-policy",
  "sandbox-m1",
  "sandbox-tree",
  "sandbox-v2",
  "agent-service",
  "discord-bot",
];

function fail(reason) {
  process.stdout.write(`STATUS=ERROR\nFALLBACK_REASON=${reason}\n`);
  process.exit(1);
}

function normalizePosix(p) {
  return p.replaceAll("\\", "/");
}

function findRuntimeSources(dir) {
  const results = [];
  function walk(curr) {
    if (!fs.existsSync(curr)) return;
    let entries;
    try {
      entries = fs.readdirSync(curr, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(curr, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules" && ent.name !== "dist" && ent.name !== "__tests__") {
          walk(full);
        }
      } else if (ent.isFile() && (ent.name.endsWith(".ts") || ent.name.endsWith(".js") || ent.name.endsWith(".mjs"))) {
        if (
          !ent.name.endsWith(".test.ts") &&
          !ent.name.endsWith(".test.js") &&
          !ent.name.endsWith(".test.mjs") &&
          !ent.name.endsWith(".d.ts")
        ) {
          results.push(full);
        }
      }
    }
  }
  walk(dir);
  return results;
}

function main() {
  const repoRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

  const directDeps = new Map();
  const reverseDeps = new Map();
  for (const p of CANONICAL_ORDER) {
    directDeps.set(p, new Set());
    reverseDeps.set(p, new Set());
  }

  // 1. Inspect package.json metadata for all 7 deployable packages.
  for (const dir of CANONICAL_ORDER) {
    const pkgJsonPath = path.join(repoRoot, "apps", dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      fail(`missing_package_metadata:apps/${dir}/package.json`);
    }

    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    } catch {
      fail(`malformed_package_metadata:apps/${dir}/package.json`);
    }

    if (!pkg || typeof pkg !== "object") {
      fail(`malformed_package_metadata:apps/${dir}/package.json`);
    }

    const deps = pkg.dependencies || {};
    if (typeof deps !== "object" || Array.isArray(deps)) {
      fail(`malformed_package_dependencies:apps/${dir}/package.json`);
    }

    for (const [depName, depVal] of Object.entries(deps)) {
      if (typeof depVal === "string" && depVal.startsWith("file:")) {
        const rawPath = depVal.slice("file:".length);
        const normalized = normalizePosix(rawPath);

        // Allowed repository non-deploy package: packages/privacy-core
        if (normalized === "../../packages/privacy-core" || normalized === "../../../packages/privacy-core") {
          continue;
        }

        const m = normalized.match(/^\.\.\/([^/]+)$/);
        if (!m) {
          fail(`escaping_or_ambiguous_dependency_path:${dir}->${depVal}`);
        }

        const target = m[1];
        if (!CANONICAL_ORDER.includes(target)) {
          fail(`unknown_local_package_target:${dir}->${target}`);
        }

        const posTarget = CANONICAL_ORDER.indexOf(target);
        const posDir = CANONICAL_ORDER.indexOf(dir);
        if (posTarget >= posDir) {
          fail(`dependency_cycle_or_topology_violation:${dir}->${target}`);
        }

        directDeps.get(dir).add(target);
        reverseDeps.get(target).add(dir);
      } else if (typeof depName === "string" && depName.startsWith("@composer-assistant/")) {
        fail(`unresolvable_local_dependency:${dir}->${depName}`);
      }
    }
  }

  // 2. Mechanical audit of target source files: ensure no undeclared cross-package dependencies.
  const importRegex = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const dir of CANONICAL_ORDER) {
    const srcDir = path.join(repoRoot, "apps", dir, "src");
    const sources = findRuntimeSources(srcDir);
    for (const src of sources) {
      let content;
      try {
        content = fs.readFileSync(src, "utf8");
      } catch {
        fail(`unreadable_source_file:${normalizePosix(path.relative(repoRoot, src))}`);
      }

      const matches = [...content.matchAll(importRegex), ...content.matchAll(dynamicImportRegex)];
      for (const match of matches) {
        const spec = match[1];
        if (spec.startsWith("@composer-assistant/")) {
          const target = spec.slice("@composer-assistant/".length).split("/")[0];
          if (target === "privacy-core") {
            if (dir !== "agent-service") {
              fail(`undeclared_privacy_core_dependency:${dir}`);
            }
            continue;
          }
          if (CANONICAL_ORDER.includes(target)) {
            if (!directDeps.get(dir).has(target)) {
              fail(`undeclared_cross_package_dependency:${dir}_imports_${target}`);
            }
          } else {
            fail(`unknown_cross_package_dependency:${dir}_imports_${target}`);
          }
        } else if (spec.startsWith(".")) {
          const resolved = path.resolve(path.dirname(src), spec);
          const pkgDir = path.join(repoRoot, "apps", dir);
          const rel = path.relative(pkgDir, resolved);
          if (rel.startsWith("..") || path.isAbsolute(rel)) {
            fail(`escaping_relative_import:${dir}->${spec}`);
          }
        }
      }
    }
  }

  // 3. Emit derived reverse dependents and success status.
  process.stdout.write("STATUS=OK\n");
  for (const p of CANONICAL_ORDER) {
    const varName = "REV_" + p.replaceAll("-", "_");
    const val = Array.from(reverseDeps.get(p)).join(" ");
    process.stdout.write(`${varName}="${val}"\n`);
  }
}

main();
