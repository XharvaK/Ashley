import type {
  ProviderId,
  QuotaBucket,
  RouteBinding,
  RouteId,
} from "./types.js";
import { quotaBucketFor } from "./types.js";
import { AppError } from "../../errors.js";

/**
 * Compatibility route registry for the current Model Fabric portfolio. Model
 * IDs and lifecycle values are resolved from the validated current portfolio;
 * this table retains the stable route vocabulary and quota defaults used by
 * the routing compatibility surface.
 */
export const ROUTE_BINDINGS: readonly RouteBinding[] = [
  {
    route: "ashley_expression",
    provider: "nim",
    configuredModelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    contextProfile: "full_expression",
    enabled: true,
  },
  {
    route: "ashley_expression_fallback",
    provider: "groq",
    configuredModelId: "qwen/qwen3.6-27b",
    contextProfile: "minimal_expression_identity",
    enabled: true,
  },
  {
    route: "thought",
    provider: "cloudflare",
    configuredModelId: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    contextProfile: "thought_summary",
    enabled: true,
  },
  {
    route: "utility_bulk",
    provider: "nim",
    configuredModelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    contextProfile: "utility_redacted",
    enabled: true,
  },
  {
     route: "sandbox_operator_light",
     provider: "nim",
     configuredModelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
     contextProfile: "sandbox_project_only",
     enabled: false,
  },
  {
     route: "sandbox_operator_deep",
     provider: "nim",
     configuredModelId: "nvidia/nemotron-3-ultra-550b-a55b",
     contextProfile: "sandbox_project_only",
     enabled: false,
  },
  {
    route: "sandbox_reviewer",
    provider: "nim",
    configuredModelId: "nvidia/nemotron-3-ultra-550b-a55b",
    contextProfile: "experimental_internal_project",
    enabled: false,
  },
  {
    route: "experimental_auditor",
    provider: "nim",
    configuredModelId: "nvidia/nemotron-3-ultra-550b-a55b",
    contextProfile: "experimental_internal_project",
    enabled: false,
  },
  {
    route: "experimental_multimodal",
    provider: "nim",
    configuredModelId: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    contextProfile: "experimental_public",
    enabled: false,
  },
];

const BY_ROUTE = new Map<RouteId, RouteBinding>(
  ROUTE_BINDINGS.map((binding) => [binding.route, binding]),
);

export function routeBinding(route: RouteId): RouteBinding {
  const binding = BY_ROUTE.get(route);
  if (!binding) {
    throw new AppError("route_disabled", `unknown_route:${route}`, 404);
  }
  return binding;
}

export function bucketForRoute(route: RouteId): QuotaBucket {
  const binding = routeBinding(route);
  return quotaBucketFor(binding.provider, binding.configuredModelId);
}

export function providersInUse(): ProviderId[] {
  return Array.from(new Set(ROUTE_BINDINGS.map((binding) => binding.provider)));
}
