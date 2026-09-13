#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readJson(relativePath) {
  const file = join(root, relativePath);
  if (!existsSync(file)) throw new Error(`missing_file:${relativePath}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function runHealthAudit(rootDir = root) {
  const errors = [];
  const registry = readJsonFrom(rootDir, "apps/agent-service/route-surface.json");
  const routes = Array.isArray(registry.routes) ? registry.routes : [];
  const publicHealth = routes.find((route) =>
    route?.method === "GET" && route?.path === "/health",
  );
  const detailedHealth = routes.find((route) =>
    route?.method === "GET" && route?.path === "/nuclear/health",
  );
  if (publicHealth?.ownerScope !== "public" || publicHealth?.lifecycle !== "active") {
    errors.push("public_health_route_contract");
  }
  if (detailedHealth?.ownerScope !== "owner_required" || detailedHealth?.lifecycle !== "active") {
    errors.push("detailed_health_owner_gate");
  }

  const server = readFileSync(join(rootDir, "apps/agent-service/src/server.ts"), "utf8");
  for (const field of ["ok", "ready", "state", "uptimeSec", "providerState"]) {
    if (!server.includes(`${field}:`)) errors.push(`public_health_field_missing:${field}`);
  }
  for (const forbidden of [
    "mistralConfigured: manager.isMistralConfigured()",
    "nuclear: manager.core.getHealth()",
    "proactive: {",
  ]) {
    if (server.includes(forbidden)) errors.push(`public_health_field_leak:${forbidden}`);
  }
  const detailedBlock = server.slice(server.indexOf('app.get("/nuclear/health"'));
  if (!detailedBlock.includes("requireOwner(ownerId || undefined)")) {
    errors.push("detailed_health_owner_check_missing");
  }
  if (!detailedBlock.includes("getHealthSnapshot")) {
    errors.push("detailed_health_snapshot_missing");
  }

  const env = readFileSync(join(rootDir, "apps/agent-service/src/env.ts"), "utf8");
  if (!env.includes('process.env.AGENT_BIND_HOST ?? "127.0.0.1"')) {
    errors.push("agent_bind_host_not_loopback_default");
  }
  if (errors.length > 0) throw new Error(errors.join(","));
  return {
    publicFields: ["ok", "ready", "state", "uptimeSec", "providerState"],
    detailedRoute: "GET /nuclear/health",
    ownerProtected: true,
    loopbackDefault: true,
  };
}

function readJsonFrom(rootDir, relativePath) {
  const file = join(rootDir, relativePath);
  if (!existsSync(file)) throw new Error(`missing_file:${relativePath}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function isMain() {
  return process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check-only") {
    console.error("usage: node scripts/stabilization/audit-health.mjs --check-only");
    process.exit(2);
  }
  try {
    const result = runHealthAudit();
    console.log(`Wave 10c health audit passed: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`Wave 10c health audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
