import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type express from "express";

export type RouteOwnerScope = "public" | "owner_required" | "internal";
export type RouteLifecycle = "active" | "retired";

export type RouteSurfaceEntry = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  ownerScope: RouteOwnerScope;
  lifecycle: RouteLifecycle;
};

type RouteSurfaceFile = {
  version: number;
  routes: RouteSurfaceEntry[];
};

type ExpressRouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
  };
};

function readRouteSurface(): RouteSurfaceEntry[] {
  const file = fileURLToPath(new URL("../route-surface.json", import.meta.url));
  const parsed = JSON.parse(readFileSync(file, "utf8")) as RouteSurfaceFile;
  if (parsed.version !== 1 || !Array.isArray(parsed.routes)) {
    throw new Error("route_surface_invalid");
  }
  return parsed.routes;
}

export const routeSurface = readRouteSurface();

function actualRouteKeys(app: express.Express): string[] {
  const candidate = app as express.Express & {
    _router?: { stack?: ExpressRouteLayer[] };
  };
  const stack = (candidate._router?.stack ?? []) as ExpressRouteLayer[];
  return stack.flatMap((layer: ExpressRouteLayer) => {
    const route = layer.route;
    if (!route?.path || !route.methods) return [];
    return Object.entries(route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => `${method.toUpperCase()} ${route.path}`);
  });
}

function expectedRouteKeys(): string[] {
  return routeSurface.map((entry) => `${entry.method} ${entry.path}`);
}

export function assertRegisteredRoutes(app: express.Express): void {
  const expected = [...expectedRouteKeys()].sort();
  const actual = [...actualRouteKeys(app)].sort();
  if (expected.length !== new Set(expected).size) {
    throw new Error("route_surface_duplicate");
  }
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw new Error(
      `route_surface_drift: expected=${expected.join(",")} actual=${actual.join(",")}`,
    );
  }
}
