/**
 * Isolated OpenCode HOME: durable auth/config only; disposable per-admission
 * task/conversation/cache. Worker env is an allowlist, never parent process.env.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const FORBIDDEN_WORKER_ENV_KEYS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "DISCORD_BOT_TOKEN",
  "MISTRAL_API_KEY",
  "MISTRAL_API_KEY_SECONDARY",
  "GROQ_API_KEY",
  "NIM_API_KEY",
  "OPENCODE_ZEN_API_KEY",
  "OPENCODE_WORKER_API_KEY",
  "COMPOSER_ENV_FILE",
  "ASHLEY_CLOUDFLARE_THOUGHT_AFFINITY_ID",
] as const;

const WINDOWS_SPAWN_KEYS = ["SystemRoot", "WINDIR", "PATHEXT", "COMSPEC"] as const;

export type IsolatedOpenCodeLayout = {
  root: string;
  durableDir: string;
  durableAuthPath: string;
  durableConfigPath: string;
  admissionId: string;
  admissionRoot: string;
  home: string;
  configDir: string;
  dataDir: string;
  cacheDir: string;
  stateDir: string;
  tmpDir: string;
  workDir: string;
  admissionAuthPath: string;
  admissionConfigPath: string;
};

export type WorkerEnvBuildInput = {
  layout: IsolatedOpenCodeLayout;
  path: string;
  tz?: string;
  sslCertFile?: string;
};

export function durableOpenCodePaths(root: string): {
  durableDir: string;
  durableAuthPath: string;
  durableConfigPath: string;
} {
  const durableDir = join(root, "durable");
  return {
    durableDir,
    durableAuthPath: join(durableDir, "auth.json"),
    durableConfigPath: join(durableDir, "opencode.json"),
  };
}

export function generateHostOpenCodeConfig(): string {
  return `${JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    plugin: [],
    mcp: {},
    permission: { "*": "deny" },
    tools: {
      bash: false,
      edit: false,
      write: false,
      patch: false,
      webfetch: false,
    },
  }, null, 2)}\n`;
}

export function ensureDurableOpenCodeHome(root: string): {
  durableDir: string;
  durableAuthPath: string;
  durableConfigPath: string;
} {
  const paths = durableOpenCodePaths(root);
  mkdirSync(paths.durableDir, { recursive: true });
  if (!existsSync(paths.durableConfigPath)) {
    writeFileSync(paths.durableConfigPath, generateHostOpenCodeConfig(), "utf8");
  }
  return paths;
}

export function materializeAdmissionHome(input: {
  root: string;
  admissionId: string;
}): IsolatedOpenCodeLayout {
  const durable = ensureDurableOpenCodeHome(input.root);
  const admissionRoot = join(input.root, "admissions", input.admissionId);
  const home = join(admissionRoot, "home");
  const configDir = join(admissionRoot, "config");
  const dataDir = join(admissionRoot, "data");
  const cacheDir = join(admissionRoot, "cache");
  const stateDir = join(admissionRoot, "state");
  const tmpDir = join(admissionRoot, "tmp");
  const workDir = join(admissionRoot, "work");
  for (const dir of [home, configDir, dataDir, cacheDir, stateDir, tmpDir, workDir]) {
    mkdirSync(dir, { recursive: true });
  }
  const opencodeConfigDir = join(configDir, "opencode");
  const opencodeDataDir = join(dataDir, "opencode");
  mkdirSync(opencodeConfigDir, { recursive: true });
  mkdirSync(opencodeDataDir, { recursive: true });
  const admissionConfigPath = join(opencodeConfigDir, "opencode.json");
  const admissionAuthPath = join(opencodeDataDir, "auth.json");
  copyFileSync(durable.durableConfigPath, admissionConfigPath);
  if (existsSync(durable.durableAuthPath)) {
    copyFileSync(durable.durableAuthPath, admissionAuthPath);
  }
  return {
    root: input.root,
    durableDir: durable.durableDir,
    durableAuthPath: durable.durableAuthPath,
    durableConfigPath: durable.durableConfigPath,
    admissionId: input.admissionId,
    admissionRoot,
    home,
    configDir,
    dataDir,
    cacheDir,
    stateDir,
    tmpDir,
    workDir,
    admissionAuthPath,
    admissionConfigPath,
  };
}

export function harvestDurableAuth(layout: IsolatedOpenCodeLayout): void {
  if (!existsSync(layout.admissionAuthPath)) return;
  mkdirSync(dirname(layout.durableAuthPath), { recursive: true });
  copyFileSync(layout.admissionAuthPath, layout.durableAuthPath);
}

export function destroyAdmission(layout: IsolatedOpenCodeLayout): void {
  rmSync(layout.admissionRoot, { recursive: true, force: true });
}

export function buildWorkerEnv(input: WorkerEnvBuildInput): Record<string, string> {
  const env: Record<string, string> = {
    HOME: input.layout.home,
    USERPROFILE: input.layout.home,
    XDG_CONFIG_HOME: input.layout.configDir,
    XDG_DATA_HOME: input.layout.dataDir,
    XDG_STATE_HOME: input.layout.stateDir,
    XDG_CACHE_HOME: input.layout.cacheDir,
    OPENCODE_CONFIG: input.layout.admissionConfigPath,
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    APPDATA: join(input.layout.home, "AppData", "Roaming"),
    LOCALAPPDATA: join(input.layout.home, "AppData", "Local"),
    TEMP: input.layout.tmpDir,
    TMP: input.layout.tmpDir,
    PATH: input.path,
  };
  mkdirSync(env.APPDATA, { recursive: true });
  mkdirSync(env.LOCALAPPDATA, { recursive: true });
  if (input.tz) env.TZ = input.tz;
  else if (process.env.TZ) env.TZ = process.env.TZ;
  env.LANG = process.env.LANG ?? "C.UTF-8";
  const certFile = input.sslCertFile ??
    (existsSync("/etc/ssl/certs/ca-certificates.crt")
      ? "/etc/ssl/certs/ca-certificates.crt"
      : undefined);
  if (certFile) env.SSL_CERT_FILE = certFile;
  for (const key of WINDOWS_SPAWN_KEYS) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  for (const key of FORBIDDEN_WORKER_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

export function assertWorkerEnvIsolated(env: Record<string, string>): string[] {
  const leaks: string[] = [];
  for (const key of FORBIDDEN_WORKER_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined && env[key] !== "") {
      leaks.push(key);
    }
  }
  return leaks;
}

export function createTempIsolationRoot(): string {
  return mkdtempSync(join(tmpdir(), "ashley-opencode-home-"));
}

export function readUtf8IfPresent(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}
