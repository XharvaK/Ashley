#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function text(rootDir, relativePath) {
  const file = join(rootDir, relativePath);
  if (!existsSync(file)) throw new Error(`missing_file:${relativePath}`);
  return readFileSync(file, "utf8");
}

function json(rootDir, relativePath) {
  return JSON.parse(text(rootDir, relativePath));
}

export function runMintDocsAudit(rootDir = root) {
  const errors = [];
  const dbSource = text(rootDir, "apps/agent-service/src/core/db.ts");
  const versionMatch = dbSource.match(/NUCLEAR_SUPPORTED_VERSION\s*=\s*(\d+)\s*;/);
  if (!versionMatch || Number(versionMatch[1]) < 19) {
    errors.push("schema_version_below_19");
  }
  const schemaVersion = versionMatch ? Number(versionMatch[1]) : 0;

  const routes = json(rootDir, "apps/agent-service/route-surface.json").routes ?? [];
  for (const route of [
    ["GET", "/health", "public"],
    ["GET", "/nuclear/health", "owner_required"],
  ]) {
    if (!routes.some((entry) =>
      entry.method === route[0] && entry.path === route[1] && entry.ownerScope === route[2],
    )) errors.push(`endpoint_missing:${route[0]} ${route[1]}`);
  }

  const commands = json(rootDir, "apps/discord-bot/command-surface.json");
  if (commands.version !== 1 || !Array.isArray(commands.commands)) {
    errors.push("command_surface_invalid");
  }
  const serviceDir = join(rootDir, "deploy/linux-mint/systemd");
  const services = existsSync(serviceDir)
    ? readdirSync(serviceDir).filter((name) => name.endsWith(".service")).map((name) => name.slice(0, -8)).sort()
    : [];
  for (const service of ["ashley-agent", "ashley-discord"]) {
    if (!services.includes(service)) errors.push(`service_missing:${service}`);
  }

  const backupScript = text(rootDir, "scripts/backup-memory.ps1");
  for (const required of ["nuclear.db", "continuity.db", "VACUUM INTO", "never naive WAL/SHM copy"]) {
    if (!backupScript.includes(required)) errors.push(`backup_contract_missing:${required}`);
  }
  const memoryDoc = text(rootDir, "docs/memory-and-recall.md");
  if (!/both `nuclear\.db` and the authoritative\s+`continuity\.db` sidecar/i.test(memoryDoc)) {
    errors.push("memory_doc_missing_dual_db_guidance");
  }
  if (!/Naive WAL\/SHM copying is not supported/i.test(memoryDoc)) {
    errors.push("memory_doc_missing_wal_shm_warning");
  }
  if (/Copies `nuclear\.db` \(\+ WAL\/SHM\)/i.test(memoryDoc)) {
    errors.push("stale_wal_shm_copy_guidance");
  }
  const architecture = text(rootDir, "docs/Architecture_Index.md");
  if (!architecture.includes("GET /nuclear/health?owner_id=")) {
    errors.push("architecture_health_endpoint_missing");
  }
  const readme = text(rootDir, "deploy/linux-mint/README.md");
  if (!readme.includes("ashley-agent") || !readme.includes("ashley-discord")) {
    errors.push("mint_readme_service_names_missing");
  }

  // This audit is intentionally static. It must not gain an operational escape hatch.
  const auditSource = text(rootDir, "scripts/stabilization/audit-mint-docs.mjs");
  const forbiddenTokens = [
    ["child", "_process"].join(""),
    ["fet", "ch("].join(""),
    ["system", "ctl"].join(""),
    ["s", "sh "].join(""),
    ["spa", "wn("].join(""),
    ["ex", "ec("].join(""),
  ];
  for (const forbidden of forbiddenTokens) {
    if (auditSource.includes(forbidden)) errors.push(`audit_not_check_only:${forbidden}`);
  }
  if (errors.length > 0) throw new Error(errors.join(","));
  return {
    schemaVersion,
    endpoints: ["GET /health", "GET /nuclear/health"],
    services,
    backup: "dual VACUUM snapshots; WAL/SHM copy unsupported",
    execution: "repository files only",
  };
}

function isMain() {
  return process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check-only") {
    console.error("usage: scripts/stabilization/audit-mint-docs.mjs --check-only");
    process.exit(2);
  }
  try {
    console.log(`Wave 10c Mint documentation audit passed: ${JSON.stringify(runMintDocsAudit())}`);
  } catch (error) {
    console.error(`Wave 10c Mint documentation audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
