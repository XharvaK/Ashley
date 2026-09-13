import { env } from "../../env.js";
import { AppError } from "../../errors.js";
import { routeRecordsFromCurrentPortfolio } from "../model-fabric/portfolio.js";
import { ROUTE_BINDINGS, routeBinding } from "./registry.js";
import type {
  ContextProfile,
  ProviderId,
  QuotaBucket,
  RouteBinding,
  RouteId,
} from "./types.js";

export type QuotaContract = {
  rps: number;
  rpm: number;
  rpd: number;
  tpm: number;
  tpd: number;
};

export type RouteRecord = {
  route: RouteId;
  provider: ProviderId;
  configuredModelId: string;
  contextProfile: ContextProfile;
  enabled: boolean;
  quotaContract: QuotaContract | "env";
};

export function loadRouteRecords(): RouteRecord[] {
  return routeRecordsFromCurrentPortfolio().map((record) => ({
    route: record.route as RouteId,
    provider: record.provider as ProviderId,
    configuredModelId: record.configuredModelId,
    contextProfile: record.contextProfile as ContextProfile,
    enabled: record.enabled,
    quotaContract: record.quotaContract as QuotaContract | "env",
  }));
}

function contractForProvider(provider: ProviderId): QuotaContract | "env" {
  switch (provider) {
    case "mistral":
      return "env";
    case "groq":
      return { rps: 40, rpm: 3600, rpd: 3600, tpm: 8000, tpd: 80000 };
    case "nim":
      return { rps: 30, rpm: 600, rpd: 600, tpm: 16000, tpd: 120000 };
    case "cloudflare":
      return { rps: 30, rpm: 600, rpd: 600, tpm: 65536, tpd: 120000 };
    case "opencode_zen":
      return { rps: 10, rpm: 600, rpd: 600, tpm: 16000, tpd: 120000 };
    default:
      return "env";
  }
}

const PURPOSE_TO_ROUTE: Partial<Record<string, RouteId>> = {
  expression: "ashley_expression",
  thought: "thought",
  thought_observation: "thought",
  reflection_initiative: "thought",
  exchange_cognition: "utility_bulk",
  curiosity_consolidation: "utility_bulk",
  maintenance: "utility_bulk",
};

export function resolveRoute(
  purpose: string,
  opts: { modelAlias?: string } = {},
): RouteBinding {
  const routeId = PURPOSE_TO_ROUTE[purpose as keyof typeof PURPOSE_TO_ROUTE];
  if (!routeId) {
    throw new Error(`unknown_purpose_for_route:${purpose}`);
  }
  // Enforce route lifecycle before adapter selection / quota reservation.
  return requireRouteEnabled(routeId);
}

export function disabledRouteError(route: RouteId): AppError {
  if (route.startsWith("sandbox_") || route.startsWith("experimental_")) {
    return new AppError("operator_disabled", `route disabled: ${route}`, 503);
  }
  return new AppError("route_disabled", `route disabled: ${route}`, 404);
}

export function requireRouteEnabled(route: RouteId): RouteBinding {
  const binding = routeBinding(route);
  const records = loadRouteRecords();
  const matched = records.find((r) => r.route === route);
  const enabled = matched ? matched.enabled : binding.enabled;
  if (!enabled) {
    throw disabledRouteError(route);
  }
  if (!matched) return binding;
  return {
    ...binding,
    provider: matched.provider,
    configuredModelId: matched.configuredModelId,
    contextProfile: matched.contextProfile,
    enabled: matched.enabled,
  };
}

function providerKeyPresent(provider: ProviderId): boolean {
  switch (provider) {
    case "mistral":
      return Boolean(env.mistralApiKey);
    case "groq":
      return Boolean(env.groqApiKey);
    case "nim":
      return Boolean(env.nimApiKey);
    case "cloudflare":
      return Boolean(env.cloudflareApiToken && env.cloudflareAccountId);
    case "opencode_zen":
      return Boolean(env.opencodeZenApiKey);
    default:
      return false;
  }
}

/**
 * Canonical non-throwing route readiness check. A route is ready when it is
 * enabled (configured record, else static binding) AND the provider actually
 * bound to that route has its credential present. Cognition phases request a
 * semantic route ("thought") and defer provider-specific readiness to the
 * routing layer instead of hardcoding a provider.
 */
export function routeReady(route: RouteId): boolean {
  try {
    const binding = routeBinding(route);
    const records = loadRouteRecords();
    const matched = records.find((r) => r.route === route);
    const enabled = matched ? matched.enabled : binding.enabled;
    if (!enabled) return false;
    const provider = matched ? matched.provider : binding.provider;
    if (providerKeyPresent(provider)) return true;
    return false;
  } catch {
    return false;
  }
}

export function routeForBucket(bucket: QuotaBucket): RouteRecord | undefined {
  const parts = bucket.split(":");
  const provider = parts[0] as ProviderId | undefined;
  const model = parts[1];
  if (!provider) return undefined;
  const records = loadRouteRecords();
  return records.find(
    (r) => r.provider === provider && r.configuredModelId === model,
  );
}

export function quotaContractFor(bucket: QuotaBucket): QuotaContract {
  const record = routeForBucket(bucket);
  if (record?.enabled && record.quotaContract !== "env") {
    return record.quotaContract;
  }
  if (!record || !record.enabled) {
    const provider = bucket.split(":", 1)[0] as ProviderId | undefined;
    const providerContract = provider ? contractForProvider(provider) : "env";
    if (providerContract !== "env") return providerContract;
  }
  // Mistral (and any env-driven bucket) derive limits from env.
  const rps = env.mistralRequestsPerSecond;
  return {
    rps,
    rpm: rps * 60,
    rpd: rps * 3600,
    tpm: env.mistralTokensPerMinute,
    tpd: env.mistralTokensPerMinute * 60,
  };
}
