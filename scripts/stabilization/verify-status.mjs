import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== "--check") {
  console.error("usage: node scripts/stabilization/verify-status.mjs --check");
  process.exit(2);
}

const errors = [];

function readJson(relativePath) {
  const file = join(root, relativePath);
  if (!existsSync(file)) {
    errors.push(`missing_file:${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`invalid_json:${relativePath}:${error instanceof Error ? error.message : "parse_failed"}`);
    return null;
  }
}

function sortedUnique(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    errors.push(`${label}_not_string_array`);
    return [];
  }
  const sorted = [...values].sort();
  if (sorted.length !== new Set(sorted).size) errors.push(`${label}_duplicate`);
  return sorted;
}

function normalizeRoutes(routes, label) {
  if (!Array.isArray(routes)) {
    errors.push(`${label}_not_array`);
    return [];
  }
  const normalized = routes.map((route) => ({
    method: route?.method,
    path: route?.path,
    ownerScope: route?.ownerScope,
    lifecycle: route?.lifecycle,
  }));
  for (const route of normalized) {
    if (
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(route.method) ||
      typeof route.path !== "string" ||
      !["public", "owner_required", "internal"].includes(route.ownerScope) ||
      !["active", "retired"].includes(route.lifecycle)
    ) {
      errors.push(`${label}_invalid_entry:${JSON.stringify(route)}`);
    }
  }
  normalized.sort((a, b) =>
    `${a.path}\u0000${a.method}`.localeCompare(`${b.path}\u0000${b.method}`),
  );
  const keys = normalized.map((route) => `${route.method} ${route.path}`);
  if (keys.length !== new Set(keys).size) errors.push(`${label}_duplicate`);
  return normalized;
}

function discoverSchemaVersion() {
  const relativePath = "apps/agent-service/src/core/db.ts";
  const source = readFileSync(join(root, relativePath), "utf8");
  const match = source.match(
    /export\s+const\s+NUCLEAR_SUPPORTED_VERSION\s*=\s*(\d+)\s*;/,
  );
  if (!match) {
    errors.push("nuclear_schema_export_missing");
    return null;
  }
  return Number(match[1]);
}

function discoverCapabilities() {
  const relativePath = "apps/agent-service/src/core/rollout/capabilities.ts";
  const source = readFileSync(join(root, relativePath), "utf8");
  const match = source.match(
    /export\s+const\s+capabilityNames\s*=\s*\[(.*?)\]\s*as\s+const/s,
  );
  if (!match) {
    errors.push("capability_names_export_missing");
    return [];
  }
  return sortedUnique(
    [...match[1].matchAll(/"([^"\r\n]+)"/g)].map((entry) => entry[1]),
    "capability_names",
  );
}

function discoverPrompts() {
  const directory = join(root, "workspace/prompts/nuclear");
  if (!existsSync(directory)) {
    errors.push("missing_prompt_directory");
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function discoverProbeFacts(probes) {
  if (!probes || typeof probes !== "object") return { version: null, ids: [] };
  return {
    version: probes.version,
    ids: sortedUnique(
      Array.isArray(probes.probes) ? probes.probes.map((probe) => probe?.id) : [],
      "evaluation_probe_ids",
    ),
  };
}

function discoverServices() {
  const directory = join(root, "deploy/linux-mint/systemd");
  if (!existsSync(directory)) {
    errors.push("missing_systemd_directory");
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".service"))
    .map((entry) => basename(entry.name, ".service"))
    .sort();
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || manifest.version !== 1) {
    errors.push("manifest_version_invalid");
    return 0;
  }
  if (!Array.isArray(manifest.entries)) {
    errors.push("manifest_entries_missing");
    return 0;
  }
  const owners = new Set([
    "Identity", "MindState", "Thought", "Reflection", "Expression",
    "Rendering", "Delivery", "Memory", "Cognition", "Curiosity", "Agency",
    "Continuity", "Privacy", "Capability", "Broker", "Operations",
    "Evaluation", "Governance",
  ]);
  const implementationStatuses = new Set([
    "implemented", "local_not_release_qualified", "design_only", "planned", "legacy_local",
  ]);
  const stages = new Set([
    "design_complete", "design_accepted", "implementation_present", "locally_verified",
    "wave_accepted", "release_qualified", "deployed", "planned", "legacy_local",
  ]);
  const promotionStates = new Set(["observe", "shadow", "active", "rolled_back", "disabled", "n/a"]);
  const observeKinds = new Set(["endpoint", "field", "table", "n/a"]);
  const ids = new Set();
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== "object") {
      errors.push("manifest_entry_invalid");
      continue;
    }
    if (typeof entry.clauseId !== "string" || !/^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?$/.test(entry.clauseId)) {
      errors.push(`manifest_clause_id_invalid:${String(entry.clauseId)}`);
    } else if (ids.has(entry.clauseId)) {
      errors.push(`manifest_clause_id_duplicate:${entry.clauseId}`);
    } else {
      ids.add(entry.clauseId);
    }
    if (!owners.has(entry.owner)) errors.push(`manifest_owner_invalid:${entry.clauseId}`);
    if (!implementationStatuses.has(entry.implementationStatus)) {
      errors.push(`manifest_implementation_status_invalid:${entry.clauseId}`);
    }
    if (!stages.has(entry.stage)) errors.push(`manifest_stage_invalid:${entry.clauseId}`);
    if (!promotionStates.has(entry.promotionState)) errors.push(`manifest_promotion_state_invalid:${entry.clauseId}`);
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0 || entry.evidence.some((value) => typeof value !== "string")) {
      errors.push(`manifest_evidence_invalid:${entry.clauseId}`);
    } else {
      for (const evidence of entry.evidence) {
        const pathPart = evidence.split("#", 1)[0];
        if (isAbsolute(pathPart) || /^[A-Za-z]:/.test(pathPart)) errors.push(`manifest_absolute_evidence:${entry.clauseId}`);
        if (/\.env|MISTRAL_API_KEY|DISCORD_BOT_TOKEN|BEGIN (?:RSA |EC )?PRIVATE KEY/i.test(evidence)) {
          errors.push(`manifest_secret_evidence:${entry.clauseId}`);
        }
      }
    }
    if (!entry.runtimeObserve || !observeKinds.has(entry.runtimeObserve.kind) || typeof entry.runtimeObserve.ref !== "string") {
      errors.push(`manifest_runtime_observe_invalid:${entry.clauseId}`);
    }
    if (typeof entry.failureSignal !== "string" || !entry.failureSignal.trim()) {
      errors.push(`manifest_failure_signal_missing:${entry.clauseId}`);
    }
    if (typeof entry.rollbackOrDisable !== "string" || !entry.rollbackOrDisable.trim()) {
      errors.push(`manifest_rollback_missing:${entry.clauseId}`);
    }
    if (["design_accepted", "wave_accepted", "release_qualified", "deployed"].includes(entry.stage)) {
      if (typeof entry.gateRef !== "string" || !entry.gateRef.trim()) {
        errors.push(`manifest_gate_ref_missing:${entry.clauseId}`);
      } else {
        const gateFile = resolve(root, entry.gateRef);
        if (!gateFile.startsWith(root) || !existsSync(gateFile)) {
          errors.push(`manifest_gate_ref_invalid:${entry.clauseId}`);
        } else {
          const gateText = readFileSync(gateFile, "utf8");
          const expectedStatus = entry.stage === "wave_accepted" || entry.stage === "release_qualified" || entry.stage === "deployed"
            ? "Wave_accepted"
            : "Design_accepted";
          if (!new RegExp(`Status:\\*\\*\\s+\\*\\*${expectedStatus}\\*\\*`).test(gateText)) {
            errors.push(`manifest_gate_status_mismatch:${entry.clauseId}`);
          }
        }
      }
    } else if (entry.gateRef !== null) {
      errors.push(`manifest_unexpected_gate_ref:${entry.clauseId}`);
    }
  }
  for (const required of ["ETH-SEC-01", "delivery:discord-ledger", "cap:external_observe", "design:sandbox-os-boundary", "continuity:wave04"]) {
    if (!ids.has(required)) errors.push(`manifest_required_example_missing:${required}`);
  }
  return manifest.entries.length;
}

const routeRegistry = readJson("apps/agent-service/route-surface.json") ?? {};
const commandRegistry = readJson("apps/discord-bot/command-surface.json") ?? {};
const probes = readJson("scripts/persona-eval/probes.json");
const manifest = readJson("docs/stabilization/clause-manifest.json");
const baseline = readJson("docs/stabilization/status-baseline.json");

const probeFacts = discoverProbeFacts(probes);
const discovered = {
  nuclearSchemaVersion: discoverSchemaVersion(),
  capabilityNames: discoverCapabilities(),
  routes: normalizeRoutes(routeRegistry.routes, "route_registry"),
  slashCommands: sortedUnique(commandRegistry.commands, "slash_commands"),
  nuclearPromptFiles: discoverPrompts(),
  evaluationProbeVersion: probeFacts.version,
  evaluationProbeIds: probeFacts.ids,
  mintServices: discoverServices(),
};

if (routeRegistry.version !== 1) errors.push("route_registry_version_invalid");
if (commandRegistry.version !== 1) errors.push("command_registry_version_invalid");
if (discovered.evaluationProbeVersion !== 3) errors.push("evaluation_probe_version_unexpected");
const manifestCount = validateManifest(manifest);

if (!baseline || typeof baseline !== "object" || baseline.version !== 1) {
  errors.push("status_baseline_version_invalid");
} else {
  const expected = JSON.stringify(discovered, null, 2);
  const actual = JSON.stringify({
    nuclearSchemaVersion: baseline.nuclearSchemaVersion,
    capabilityNames: sortedUnique(baseline.capabilityNames, "baseline_capability_names"),
    routes: normalizeRoutes(baseline.routes, "baseline_routes"),
    slashCommands: sortedUnique(baseline.slashCommands, "baseline_slash_commands"),
    nuclearPromptFiles: sortedUnique(baseline.nuclearPromptFiles, "baseline_prompt_files"),
    evaluationProbeVersion: baseline.evaluationProbeVersion,
    evaluationProbeIds: sortedUnique(baseline.evaluationProbeIds, "baseline_probe_ids"),
    mintServices: sortedUnique(baseline.mintServices, "baseline_mint_services"),
  }, null, 2);
  if (expected !== actual) {
    errors.push(`status_baseline_drift:\nexpected=${expected}\nactual=${actual}`);
  }
}

if (errors.length > 0) {
  console.error(`Wave 10a status verification failed (${errors.length} issue(s))`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Wave 10a status verification passed: ${manifestCount} manifest entries, ${discovered.routes.length} routes, ${discovered.capabilityNames.length} capabilities, ${discovered.slashCommands.length} commands`);
