import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_WORKER_ENV_KEYS,
  assertWorkerEnvIsolated,
  buildWorkerEnv,
  createTempIsolationRoot,
  destroyAdmission,
  harvestDurableAuth,
  materializeAdmissionHome,
} from "./isolation.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("OpenCode isolation", () => {
  it("does not copy parent secrets into the worker env allowlist", () => {
    const root = createTempIsolationRoot();
    roots.push(root);
    const layout = materializeAdmissionHome({ root, admissionId: "adm-1" });
    const env = buildWorkerEnv({
      layout,
      path: "/usr/bin",
    });
    for (const key of FORBIDDEN_WORKER_ENV_KEYS) {
      expect(env[key]).toBeUndefined();
    }
    expect(assertWorkerEnvIsolated(env)).toEqual([]);
    expect(env.HOME).toBe(layout.home);
    expect(env.HOME).not.toBe(process.env.HOME);
    expect(env.COMPOSER_ENV_FILE).toBeUndefined();
    expect(env.OPENCODE_CONFIG).toBe(layout.admissionConfigPath);
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(env.LANG).toBeTruthy();
    if (existsSync("/etc/ssl/certs/ca-certificates.crt")) {
      expect(env.SSL_CERT_FILE).toBe("/etc/ssl/certs/ca-certificates.crt");
    }
  });

  it("keeps durable auth and discards admission conversation state", () => {
    const root = createTempIsolationRoot();
    roots.push(root);
    const first = materializeAdmissionHome({ root, admissionId: "task-a" });
    writeFileSync(first.admissionAuthPath, JSON.stringify({ token: "durable-auth" }), "utf8");
    mkdirSync(join(first.dataDir, "opencode"), { recursive: true });
    writeFileSync(join(first.dataDir, "opencode", "opencode.db"), "TASK-A-CANARY-SEMANTIC", "utf8");
    harvestDurableAuth(first);
    destroyAdmission(first);

    const second = materializeAdmissionHome({ root, admissionId: "task-b" });
    expect(existsSync(second.admissionAuthPath)).toBe(true);
    expect(readFileSync(second.admissionAuthPath, "utf8")).toContain("durable-auth");
    expect(existsSync(join(second.dataDir, "opencode", "opencode.db"))).toBe(false);
    expect(existsSync(first.admissionRoot)).toBe(false);
  });
});
