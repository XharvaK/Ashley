import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const http = require("node:http") as typeof import("node:http");
const https = require("node:https") as typeof import("node:https");

export type OfflineNetworkAttempt = {
  transport: "fetch" | "http" | "https";
  target: string;
};

export type OfflineNetworkGuard = {
  attempts: OfflineNetworkAttempt[];
  restore: () => void;
};

let activeGuard: OfflineNetworkGuard | null = null;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function targetFor(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  if (typeof input === "object" && input !== null) {
    const value = input as Record<string, unknown>;
    if (typeof value.url === "string") return value.url;
    if (typeof value.href === "string") return value.href;
    const protocol = typeof value.protocol === "string" ? value.protocol : "http:";
    const host =
      typeof value.hostname === "string"
        ? value.hostname
        : typeof value.host === "string"
          ? value.host
          : "";
    const path = typeof value.path === "string" ? value.path : "/";
    if (host) return `${protocol}//${host}${path}`;
  }
  return "unknown";
}

function safeTarget(target: string): string {
  try {
    const parsed = new URL(target);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return target.slice(0, 200);
  }
}

function isLoopbackTarget(input: unknown): boolean {
  if (typeof input === "object" && input !== null) {
    const value = input as Record<string, unknown>;
    if (typeof value.socketPath === "string" && value.socketPath.length > 0) {
      return true;
    }
  }
  try {
    const parsed = new URL(targetFor(input));
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function installBlockedTransport(
  attempts: OfflineNetworkAttempt[],
  transport: OfflineNetworkAttempt["transport"],
  input: unknown,
): Error {
  const target = safeTarget(targetFor(input));
  attempts.push({ transport, target });
  process.exitCode = 1;
  const error = new Error(`offline_external_network_blocked:${transport}:${target}`);
  console.error(error.message);
  return error;
}

export function installOfflineNetworkGuard(): OfflineNetworkGuard {
  if (activeGuard) return activeGuard;

  const attempts: OfflineNetworkAttempt[] = [];
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;

  const blockedFetch: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (isLoopbackTarget(input)) return originalFetch(input, init);
    return Promise.reject(installBlockedTransport(attempts, "fetch", input));
  }) as typeof fetch;

  const blockedHttpRequest = (...args: unknown[]) => {
    const input = args[0];
    if (isLoopbackTarget(input)) {
      return (originalHttpRequest as (...values: unknown[]) => unknown)(...args);
    }
    throw installBlockedTransport(attempts, "http", input);
  };

  const blockedHttpGet = (...args: unknown[]) => {
    const input = args[0];
    if (isLoopbackTarget(input)) {
      return (originalHttpGet as (...values: unknown[]) => unknown)(...args);
    }
    throw installBlockedTransport(attempts, "http", input);
  };

  const blockedHttpsRequest = (...args: unknown[]) => {
    const input = args[0];
    if (isLoopbackTarget(input)) {
      return (originalHttpsRequest as (...values: unknown[]) => unknown)(...args);
    }
    throw installBlockedTransport(attempts, "https", input);
  };

  const blockedHttpsGet = (...args: unknown[]) => {
    const input = args[0];
    if (isLoopbackTarget(input)) {
      return (originalHttpsGet as (...values: unknown[]) => unknown)(...args);
    }
    throw installBlockedTransport(attempts, "https", input);
  };

  globalThis.fetch = blockedFetch;
  http.request = blockedHttpRequest as typeof http.request;
  http.get = blockedHttpGet as typeof http.get;
  https.request = blockedHttpsRequest as typeof https.request;
  https.get = blockedHttpsGet as typeof https.get;
  syncBuiltinESMExports();

  const guard: OfflineNetworkGuard = {
    attempts,
    restore: () => {
      if (activeGuard !== guard) return;
      globalThis.fetch = originalFetch;
      http.request = originalHttpRequest;
      http.get = originalHttpGet;
      https.request = originalHttpsRequest;
      https.get = originalHttpsGet;
      syncBuiltinESMExports();
      activeGuard = null;
    },
  };
  activeGuard = guard;
  return guard;
}

if (process.env.ASHLEY_PHASE0_OFFLINE === "true") {
  installOfflineNetworkGuard();
}
