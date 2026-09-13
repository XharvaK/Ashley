import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
function applyDotEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Explicit env-file activation. Importing this module does not load production .env. */
export function loadEnvFile(envPath: string): void {
  applyDotEnvFile(envPath);
  refreshEnvFromProcess();
}

/**
 * Boot errors are fatal: malformed security configuration must never be
 * coerced into a permissive value. `ok: false` from validateBoot() sends the
 * agent offline instead of running with a guessed setting.
 */
let bootErrors: string[] = [];
let numericWarnings: string[] = [];

function numericEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max ||
    (integer && !Number.isInteger(parsed))
  ) {
    numericWarnings.push(`${name} invalid; using ${fallback}`);
    return fallback;
  }
  return parsed;
}

function strictBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw.trim() === "true") return true;
  if (raw.trim() === "false") return false;
  bootErrors.push(`${name} must be "true" or "false"`);
  return fallback;
}

function strictTrimmed(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") {
    bootErrors.push(`${name} must not be empty`);
    return fallback;
  }
  return trimmed;
}

/**
 * Host-owned Cloudflare Thought session-affinity identifier. Undefined means
 * affinity is intentionally disabled and boots normally. A defined value must
 * be opaque operator configuration (16–128 chars of [A-Za-z0-9_-]); anything
 * else is a boot/config validation failure, never silently disabled. This is
 * Ashley's Host validation policy, not a Cloudflare syntax requirement.
 */
function cloudflareThoughtAffinityId(): string {
  const raw = process.env.ASHLEY_CLOUDFLARE_THOUGHT_AFFINITY_ID;
  if (raw === undefined) return "";
  const trimmed = raw.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(trimmed)) {
    bootErrors.push(
      "ASHLEY_CLOUDFLARE_THOUGHT_AFFINITY_ID must be 16-128 chars of [A-Za-z0-9_-]",
    );
    return "";
  }
  return trimmed;
}

function createEnv() {
  bootErrors = [];
  numericWarnings = [];
  return {
  ashleyReleaseId: process.env.ASHLEY_RELEASE_ID ?? "",
  mistralApiKey: process.env.MISTRAL_API_KEY ?? "",
  mistralApiKeySecondary: process.env.MISTRAL_API_KEY_SECONDARY ?? "",
  mistralBaseUrl:
    process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1",
  mistralModel: process.env.MISTRAL_MODEL ?? "mistral-small-2603",
  mistralReasoningEffort:
    (process.env.MISTRAL_REASONING_EFFORT as
      | "low"
      | "medium"
      | "high"
      | undefined) ??
    ((process.env.MISTRAL_REASONING_DEFAULT as
      | "low"
      | "medium"
      | "high"
      | undefined) ?? "medium"),
  // Mistral documents 0.0-0.7; above that a bilingual bot starts switching
  // language mid-sentence, so the ceiling is enforced here rather than trusted.
  mistralChatTemperature: numericEnv(
    "MISTRAL_CHAT_TEMPERATURE",
    0.7,
    0,
    0.7,
  ),
  discordOwnerId: process.env.DISCORD_OWNER_ID ?? "",
  memoryOwnerId:
    process.env.MEMORY_OWNER_ID ?? process.env.DISCORD_OWNER_ID ?? "",
  agentPort: numericEnv("AGENT_PORT", 3710, 1, 65_535, true),
  agentBindHost: process.env.AGENT_BIND_HOST ?? "127.0.0.1",
  nodeEnv: process.env.NODE_ENV ?? "development",
  personaEvalMode: process.env.PERSONA_EVAL_MODE === "true",
  proactiveEnabled: process.env.PROACTIVE_ENABLED !== "false",
  proactiveMaxPerDay: numericEnv("PROACTIVE_MAX_PER_DAY", 10, 0, 100, true),
  proactiveMinIdleHours: numericEnv("PROACTIVE_MIN_IDLE_HOURS", 2, 0, 168),
  reflectionMode:
    process.env.ASHLEY_REFLECTION_MODE === "apply"
      ? ("apply" as const)
      : ("observe" as const),
  cognitionMode:
    process.env.ASHLEY_COGNITION_MODE === "apply"
      ? ("apply" as const)
      : ("observe" as const),
  cognitionDispatchIntervalSec: numericEnv(
    "COGNITION_DISPATCH_INTERVAL_SEC",
    30,
    5,
    3600,
  ),
  mistralRequestsPerSecond: numericEnv(
    "MISTRAL_REQUESTS_PER_SECOND",
    1,
    1,
    100,
    true,
  ),
  mistralTokensPerMinute: numericEnv(
    "MISTRAL_TOKENS_PER_MINUTE",
    25_000,
    1_000,
    10_000_000,
    true,
  ),
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqBaseUrl:
    process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  groqDefaultModel: process.env.GROQ_DEFAULT_MODEL ?? "openai/gpt-oss-20b",
  // NVIDIA NIM: these settings configure the adapter when an active resolved
  // route selects NIM. Provider/model selection belongs to Model Fabric and
  // the control root; missing keys remain optional at boot.
  nimApiKey: process.env.NIM_API_KEY ?? "",
  nimBaseUrl:
    process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  // Cloudflare Workers AI Thought host. The account id is used only to form
  // the direct account endpoint; neither value is logged or sent to Thought.
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
  // Stable Host-owned routing-locality identifier for the exact Cloudflare
  // DeepSeek Thought route. Non-secret, opaque, never model-visible, never
  // logged raw. Empty/unset means affinity is intentionally disabled.
  cloudflareThoughtAffinityId: cloudflareThoughtAffinityId(),
  // OpenCode Zen is a dark, utility-only Track A substrate. Missing key does
  // not affect boot or current compatibility routing.
  opencodeZenApiKey: process.env.OPENCODE_ZEN_API_KEY ?? "",
  opencodeZenBaseUrl:
    process.env.OPENCODE_ZEN_BASE_URL ?? "https://opencode.ai/zen/v1",
  // Visible Expression fallback (Wave 3): composition owns whether fallback
  // may run on an eligible turn; Model Fabric owns the provider/model selected
  // for the resolved ashley_expression_fallback route. ON by default; opt out
  // with ASHLEY_EXPRESSION_FALLBACK=false.
  expressionFallbackEnabled:
    process.env.ASHLEY_EXPRESSION_FALLBACK !== "false",
  expressionFallbackRecentTurns: numericEnv(
    "ASHLEY_EXPRESSION_FALLBACK_RECENT_TURNS",
    6,
    4,
    8,
    true,
  ),
  // Owner-marked Decision kinds that must never leave the Mistral lane.
  mistralOnlyKinds: (process.env.ASHLEY_EXPRESSION_MISTRAL_ONLY_KINDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  perceptionDispatchSafetyMs: numericEnv(
    "PERCEPTION_DISPATCH_SAFETY_MS",
    300,
    0,
    9_999,
    true,
  ),
  repairCoolingHours: numericEnv("ASHLEY_REPAIR_COOLING_HOURS", 24, 1, 168),
  reminderMissedGraceHours: numericEnv(
    "ASHLEY_REMINDER_MISSED_GRACE_HOURS",
    1,
    0,
    72,
  ),
  cognitionIdleConsolidationMin: numericEnv(
    "COGNITION_IDLE_CONSOLIDATION_MIN",
    10,
    0,
    1440,
  ),
  curiosityEnabled: process.env.CURIOSITY_ENABLED !== "false",
  // Sandbox V2 direct execution lifecycle master switch. It is fail-closed by
  // default and gates only the current V2 execution path.
  sandboxEngineeringLifecycleEnabled: strictBoolean(
    "ASHLEY_SANDBOX_ENGINEERING_LIFECYCLE_ENABLED",
    false,
  ),
  // Host-provided allowlisted V2 project registry (operator config, never
  // model-writable). Empty/unset => no project authority.
  sandboxProjectRegistryPath: strictTrimmed(
    "ASHLEY_SANDBOX_PROJECT_REGISTRY",
    join(homedir(), ".composer-assistant", "sandbox", "project-roots.json"),
  ),
  };
}

const pointedEnvFile = process.env.COMPOSER_ENV_FILE?.trim();
if (pointedEnvFile) {
  applyDotEnvFile(pointedEnvFile);
}

export const env = createEnv();

export function refreshEnvFromProcess(): void {
  Object.assign(env, createEnv());
}

export function validateBoot(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors = [...bootErrors];
  const warnings = [...numericWarnings];
  if (!env.memoryOwnerId) {
    warnings.push(
      "MEMORY_OWNER_ID / DISCORD_OWNER_ID missing — set owner for nuclear memory",
    );
  }
  return { ok: errors.length === 0, errors, warnings };
}
