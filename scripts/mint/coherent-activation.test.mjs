import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASH = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/usr/bin/bash";

function posix(value) {
  return value.replace(/^([A-Za-z]):/, (_m, d) => `/${d.toLowerCase()}`).replaceAll("\\", "/");
}

function writeExec(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body.replaceAll("\r\n", "\n"));
  chmodSync(file, 0o755);
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ashley-slice-c-"));
  const repo = path.join(root, "repo");
  const home = path.join(root, "home");
  const unitSrc = path.join(repo, "deploy", "linux-mint", "systemd");
  const unitDir = path.join(home, ".config", "systemd", "user");
  const fakeBin = path.join(root, "bin");
  const log = path.join(root, "commands.log");
  const state = path.join(root, "systemd-state");
  mkdirSync(unitSrc, { recursive: true });
  mkdirSync(unitDir, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(state, { recursive: true });
  for (const app of ["sandbox-policy", "sandbox-m1", "sandbox-tree", "sandbox-v2", "agent-service", "discord-bot"]) {
    mkdirSync(path.join(repo, "apps", app, "src"), { recursive: true });
    // Steady-state Mint always has installed node_modules from the last
    // successful activation; impact-aware plans skip npm ci on that basis.
    mkdirSync(path.join(repo, "apps", app, "node_modules"), { recursive: true });
    copyFileSync(
      path.join(ROOT, "apps", app, "package.json"),
      path.join(repo, "apps", app, "package.json"),
    );
    writeFileSync(path.join(repo, "apps", app, "src", "index.ts"), "export const ok = true;\n");
  }
  mkdirSync(path.join(repo, "deploy", "linux-mint"), { recursive: true });
  copyFileSync(
    path.join(ROOT, "deploy", "linux-mint", "update.sh"),
    path.join(repo, "deploy", "linux-mint", "update.sh"),
  );
  copyFileSync(
    path.join(ROOT, "deploy", "linux-mint", "plan-update.sh"),
    path.join(repo, "deploy", "linux-mint", "plan-update.sh"),
  );
  copyFileSync(
    path.join(ROOT, "deploy", "linux-mint", "derive-graph.mjs"),
    path.join(repo, "deploy", "linux-mint", "derive-graph.mjs"),
  );
  copyFileSync(
    path.join(ROOT, "deploy", "linux-mint", "sync-user-units.sh"),
    path.join(repo, "deploy", "linux-mint", "sync-user-units.sh"),
  );
  copyFileSync(
    path.join(ROOT, "deploy", "linux-mint", "systemd", "ashley-agent.service"),
    path.join(unitSrc, "ashley-agent.service"),
  );
  copyFileSync(
    path.join(ROOT, "deploy", "linux-mint", "systemd", "ashley-discord.service"),
    path.join(unitSrc, "ashley-discord.service"),
  );
  chmodSync(path.join(repo, "deploy", "linux-mint", "update.sh"), 0o755);
  chmodSync(path.join(repo, "deploy", "linux-mint", "plan-update.sh"), 0o755);
  chmodSync(path.join(repo, "deploy", "linux-mint", "derive-graph.mjs"), 0o755);
  chmodSync(path.join(repo, "deploy", "linux-mint", "sync-user-units.sh"), 0o755);
  writeFileSync(path.join(state, "ashley-agent.service"), "active\n");
  writeFileSync(path.join(state, "ashley-discord.service"), "active\n");
  writeFileSync(log, "");

  const pLog = posix(log);
  const pState = posix(state);
  const pUnitDir = posix(unitDir);
  const pHome = posix(home);

  writeExec(
    path.join(fakeBin, "node"),
    `#!/bin/sh
exec "${posix(process.execPath)}" "$@"
`,
  );

  writeExec(
    path.join(fakeBin, "git"),
    `#!/bin/sh
echo "git $*" >> "${pLog}"
case "$1" in
  rev-parse)
    case "\${2:-}" in
      *tree*) printf '%s\\n' "\${ASHLEY_FAKE_TREE:-tree0000000000000000000000000000000000000}" ;;
      *) printf '%s\\n' "\${ASHLEY_FAKE_SHA:-cafef00d}" ;;
    esac
    ;;
  diff)
    if [ "\${2:-}" = "--name-only" ]; then
      printf '%s\\n' "\${ASHLEY_FAKE_NAMES:-}"
    else
      printf '%s\\n' "\${ASHLEY_FAKE_DIFF:-}"
    fi
    ;;
  cat-file)
    # invoked as: git cat-file -e "<sha>^{commit}"
    sha="\${3%\\^{commit\\}}"
    case " \${ASHLEY_FAKE_COMMITS:-} " in
      *" $sha "*) exit 0 ;;
      *) exit 1 ;;
    esac
    ;;
  merge-base)
    [ "\${ASHLEY_FAKE_ANCESTOR:-1}" = "1" ]
    exit $?
    ;;
  status)
    if [ "\${ASHLEY_FAKE_DIRTY:-}" = "1" ]; then
      printf ' M apps/agent-service/src/dirty.ts\\n'
    fi
    exit 0
    ;;
  pull) echo "git pull is not allowed in update.sh" >&2; exit 2 ;;
  *) exit 0 ;;
esac
`,
  );
  writeExec(
    path.join(fakeBin, "npm"),
    `#!/bin/sh
echo "npm $*" >> "${pLog}"
prefix=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--prefix" ]; then prefix="$arg"; fi
  prev="$arg"
done
if [ "\${ASHLEY_NPM_FAIL:-}" = "1" ]; then exit 1; fi
if [ -n "$prefix" ] && [ "\${ASHLEY_NPM_SKIP_DIST:-}" != "1" ]; then
  base="\$(basename "$prefix")"
  mkdir -p "$prefix/dist"
  if [ "$base" = "sandbox-m1" ]; then
    printf 'export {}\\n' > "$prefix/dist/sandbox-m1.js"
  else
    printf 'export {}\\n' > "$prefix/dist/index.js"
  fi
fi
exit 0
`,
  );
  writeExec(
    path.join(fakeBin, "curl"),
    `#!/bin/sh
echo "curl $*" >> "${pLog}"
if [ "\${ASHLEY_CURL_FAIL:-}" = "1" ]; then exit 1; fi
printf '%s\\n' '{"ok":true,"ready":true,"state":"ready"}'
`,
  );
  writeExec(
    path.join(fakeBin, "systemctl"),
    `#!/bin/sh
echo "systemctl $*" >> "${pLog}"
state_dir="${pState}"
unit_dir="${pUnitDir}"
home="${pHome}"
quiet=0
cmd=""
props=""
value_only=0
units=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --user|--no-pager) shift; continue ;;
    --quiet) quiet=1; shift; continue ;;
    --value) value_only=1; shift; continue ;;
    -p) props="$props $2"; shift 2; continue ;;
    stop|start|is-active|daemon-reload|show|status|restart)
      cmd="$1"; shift; break ;;
    *) shift; continue ;;
  esac
done
while [ "$#" -gt 0 ]; do
  case "$1" in
    --quiet) quiet=1; shift ;;
    --value) value_only=1; shift ;;
    -p) props="$props $2"; shift 2 ;;
    *) units="$units $1"; shift ;;
  esac
done
read_state() { cat "$state_dir/$1" 2>/dev/null || printf inactive; }
write_state() { printf '%s\\n' "$2" > "$state_dir/$1"; }
unit_field() {
  awk -F= -v k="$2" '$1 == k { print substr(\$0, index(\$0, "=") + 1); exit }' "$unit_dir/$1"
}
mem_bytes() {
  spec="$1"
  case "\$spec" in
    *[Kk]) echo \$(( \${spec%[Kk]} * 1024 )) ;;
    *[Mm]) echo \$(( \${spec%[Mm]} * 1024 * 1024 )) ;;
    *[Gg]) echo \$(( \${spec%[Gg]} * 1024 * 1024 * 1024 )) ;;
    *) echo "\${spec%%.*}" ;;
  esac
}
case "\$cmd" in
  daemon-reload) exit 0 ;;
  stop)
    if [ "\${ASHLEY_FAKE_STOP_STICKY:-}" = "1" ]; then exit 0; fi
    for unit in \$units; do write_state "\$unit" inactive; done
    exit 0
    ;;
  start)
    if [ "\${ASHLEY_FAKE_START_FAIL:-}" = "1" ]; then exit 1; fi
    for unit in \$units; do write_state "\$unit" active; done
    exit 0
    ;;
  restart)
    if [ "\${ASHLEY_FAKE_START_FAIL:-}" = "1" ]; then exit 1; fi
    for unit in \$units; do write_state "\$unit" active; done
    exit 0
    ;;
  is-active)
    unit=\$(echo \$units | awk '{print \$1}')
    st=\$(read_state "\$unit")
    if [ "\$quiet" = "1" ]; then
      [ "\$st" = active ]
      exit \$?
    fi
    printf '%s\\n' "\$st"
    [ "\$st" = active ]
    ;;
  show)
    unit=\$(echo \$units | awk '{print \$1}')
    for prop in \$props; do
      case "\$prop" in
        FragmentPath) val="\$unit_dir/\$unit" ;;
        RestartPreventExitStatus) val=\$(unit_field "\$unit" RestartPreventExitStatus) ;;
        WorkingDirectory)
          val=\$(unit_field "\$unit" WorkingDirectory)
          val=\$(printf '%s' "\$val" | sed "s|%h|\$home|g")
          ;;
        MemoryMax) val=\$(mem_bytes "\$(unit_field "\$unit" MemoryMax)") ;;
        *) val="" ;;
      esac
      printf '%s\\n' "\$val"
    done
    exit 0
    ;;
  status) exit 0 ;;
  *) exit 0 ;;
esac
`,
  );

  return { root, repo, home, unitSrc, unitDir, fakeBin, log, state };
}

function bashEnv(fixture, extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.Path;
  delete env.PATH;
  env.HOME = posix(fixture.home);
  env.PATH = `${posix(fixture.fakeBin)}:/usr/bin:/bin`;
  env.ASHLEY_UNIT_SRC = posix(fixture.unitSrc);
  env.ASHLEY_UNIT_DIR = posix(fixture.unitDir);
  env.ASHLEY_FAKE_SHA = extra.ASHLEY_FAKE_SHA ?? "cafef00d";
  env.AGENT_HEALTH_ATTEMPTS = extra.AGENT_HEALTH_ATTEMPTS ?? "2";
  env.AGENT_HEALTH_INTERVAL_SECONDS = extra.AGENT_HEALTH_INTERVAL_SECONDS ?? "0";
  return env;
}

function runBash(fixture, script, extra = {}) {
  return spawnSync(BASH, ["-c", `export PATH="${posix(fixture.fakeBin)}:/usr/bin:/bin"; exec bash "${posix(script)}"`], {
    encoding: "utf8",
    env: bashEnv(fixture, extra),
  });
}

function runUpdate(fixture, env = {}) {
  return runBash(fixture, path.join(fixture.repo, "deploy", "linux-mint", "update.sh"), env);
}

function commands(fixture) {
  return readFileSync(fixture.log, "utf8").split(/\r?\n/).filter(Boolean);
}

function firstIndex(lines, prefix) {
  return lines.findIndex((line) => line.startsWith(prefix) || line.includes(prefix));
}

// ---- Surgery A impact-aware helpers ----

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const TREE_B = "c".repeat(40);
const CANONICAL_ORDER = "sandbox-policy sandbox-m1 sandbox-tree sandbox-v2 agent-service discord-bot";

function parsePlan(stdout) {
  const plan = {};
  for (const line of stdout.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0) plan[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return plan;
}

function runPlanner(fixture, base, target, extra = {}) {
  const script = posix(path.join(fixture.repo, "deploy", "linux-mint", "plan-update.sh"));
  const result = spawnSync(
    BASH,
    ["-c", `export PATH="${posix(fixture.fakeBin)}:/usr/bin:/bin"; exec bash "${script}" "${base}" "${target}"`],
    { encoding: "utf8", env: bashEnv(fixture, extra) },
  );
  assert.equal(result.status, 0, `planner failed: ${result.stderr}`);
  return parsePlan(result.stdout);
}

function impactEnv(fixture, diff, extra = {}) {
  return {
    ASHLEY_FAKE_SHA: SHA_B,
    ASHLEY_FAKE_TREE: TREE_B,
    ASHLEY_FAKE_COMMITS: `${SHA_A} ${SHA_B}`,
    ASHLEY_FAKE_ANCESTOR: "1",
    ASHLEY_FAKE_DIFF: diff,
    ...extra,
  };
}

function runImpactedUpdate(fixture, markerSha, diff, extra = {}) {
  const markerPath = path.join(fixture.root, "activated-sha");
  if (markerSha !== null) writeFileSync(markerPath, `${markerSha}\n`);
  const result = runUpdate(fixture, {
    ...impactEnv(fixture, diff, extra),
    ASHLEY_ACTIVATED_SHA_FILE: posix(markerPath),
  });
  return { result, markerPath };
}

function readMarker(markerPath) {
  try {
    return readFileSync(markerPath, "utf8").trim();
  } catch {
    return null;
  }
}

function buildPackages(fixture) {
  return commands(fixture)
    .filter((line) => line.startsWith("npm run build --prefix "))
    .map((line) => path.basename(line.slice("npm run build --prefix ".length)));
}

function ciPackages(fixture) {
  return commands(fixture)
    .filter((line) => line.startsWith("npm ci --prefix "))
    .map((line) => path.basename(line.slice("npm ci --prefix ".length)));
}

function hasServiceOp(fixture, verb, unit) {
  return commands(fixture).some((line) => line.includes(`${verb} `) && line.includes(unit));
}

test("update.sh and plan-update.sh do not fetch or merge", () => {
  for (const rel of ["deploy/linux-mint/update.sh", "deploy/linux-mint/plan-update.sh"]) {
    const source = readFileSync(path.join(ROOT, rel), "utf8");
    assert.equal(/\bgit\s+pull(\s|$)/.test(source), false, `${rel} must not pull`);
    assert.equal(/\bgit\s+fetch(\s|$)/.test(source), false, `${rel} must not fetch`);
    assert.equal(/\bgit\s+merge(\s|$)/.test(source), false, `${rel} must not merge`);
    assert.equal(/\bgit\s+checkout(\s|$)/.test(source), false, `${rel} must not checkout`);
  }
});

test("remote-update.ps1 checks out then execs the candidate activator", () => {
  const source = readFileSync(path.join(ROOT, "scripts", "mint", "remote-update.ps1"), "utf8");
  const pullAt = source.indexOf("git pull --ff-only");
  const execAt = source.indexOf("exec bash deploy/linux-mint/update.sh");
  const liveAt = source.indexOf("live-check.sh");
  assert.ok(pullAt >= 0, "missing git pull --ff-only");
  assert.ok(execAt > pullAt, "exec must follow checkout");
  assert.ok(liveAt > execAt, "live-check must not be in the exec'd activator snippet");
  assert.match(source, /LiveCheck/);
});

test("sync-user-units recopies candidate policy", () => {
  const fixture = createFixture();
  const destAgent = path.join(fixture.unitDir, "ashley-agent.service");
  writeFileSync(destAgent, "[Unit]\nDescription=stale\n");
  const result = runBash(fixture, path.join(fixture.repo, "deploy", "linux-mint", "sync-user-units.sh"));
  assert.equal(result.status, 0, result.stderr);
  const installed = readFileSync(destAgent, "utf8");
  const candidate = readFileSync(path.join(fixture.unitSrc, "ashley-agent.service"), "utf8");
  assert.equal(installed, candidate);
  assert.match(installed, /RestartPreventExitStatus=75 78/);
});

test("canonical activation copies policy and reloads before start", () => {
  const fixture = createFixture();
  const result = runUpdate(fixture);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const lines = commands(fixture);
  const stopAt = firstIndex(lines, "systemctl --user stop");
  const npmAt = firstIndex(lines, "npm ");
  const reloadAt = firstIndex(lines, "systemctl --user daemon-reload");
  const showAt = firstIndex(lines, "systemctl --user show");
  const startAgentAt = firstIndex(lines, "systemctl --user start ashley-agent.service");
  const startDiscordAt = firstIndex(lines, "systemctl --user start ashley-discord.service");
  assert.ok(stopAt >= 0 && npmAt > stopAt, "stop must precede npm");
  assert.ok(reloadAt > npmAt, "reload after build");
  assert.ok(showAt > reloadAt, "loaded policy check after reload");
  assert.ok(startAgentAt > showAt, "start after loaded policy check");
  assert.ok(startDiscordAt > startAgentAt, "start agent before discord");
  assert.equal(lines.some((line) => /\bgit pull\b/.test(line)), false);
  assert.equal(readFileSync(path.join(fixture.state, "ashley-agent.service"), "utf8").trim(), "active");
  assert.equal(readFileSync(path.join(fixture.state, "ashley-discord.service"), "utf8").trim(), "active");
  const installed = readFileSync(path.join(fixture.unitDir, "ashley-agent.service"), "utf8");
  assert.match(installed, /RestartPreventExitStatus=75 78/);
});

test("canonical activation builds local packages in dependency order", () => {
  const fixture = createFixture();
  const result = runUpdate(fixture);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const buildPackages = commands(fixture)
    .filter((line) => line.startsWith("npm run build --prefix "))
    .map((line) => path.basename(line.slice("npm run build --prefix ".length)));
  assert.deepEqual(buildPackages, [
    "sandbox-policy",
    "sandbox-m1",
    "sandbox-tree",
    "sandbox-v2",
    "agent-service",
    "discord-bot",
  ]);
});

test("build is refused while a unit stays active", () => {
  const fixture = createFixture();
  const result = runUpdate(fixture, { ASHLEY_FAKE_STOP_STICKY: "1" });
  assert.notEqual(result.status, 0);
  const lines = commands(fixture);
  assert.equal(lines.some((line) => line.startsWith("npm ")), false);
  assert.equal(lines.some((line) => line.includes("start ashley-agent")), false);
});

test("failed build leaves units stopped", () => {
  const fixture = createFixture();
  const result = runUpdate(fixture, { ASHLEY_FAIL_AT: "build" });
  assert.notEqual(result.status, 0);
  const lines = commands(fixture);
  assert.ok(lines.some((line) => line.includes("stop ")));
  assert.equal(lines.some((line) => line.startsWith("npm ")), false);
  assert.equal(lines.some((line) => line.includes("start ashley-agent")), false);
  assert.equal(readFileSync(path.join(fixture.state, "ashley-agent.service"), "utf8").trim(), "inactive");
  assert.equal(readFileSync(path.join(fixture.state, "ashley-discord.service"), "utf8").trim(), "inactive");
});

test("failed unit sync does not start", () => {
  const fixture = createFixture();
  const result = runUpdate(fixture, { ASHLEY_FAIL_AT: "sync" });
  assert.notEqual(result.status, 0);
  const lines = commands(fixture);
  assert.equal(lines.some((line) => line.includes("daemon-reload")), false);
  assert.equal(lines.some((line) => line.includes("start ashley-agent")), false);
  assert.equal(readFileSync(path.join(fixture.state, "ashley-agent.service"), "utf8").trim(), "inactive");
});

test("failed reload does not start", () => {
  const fixture = createFixture();
  const result = runUpdate(fixture, { ASHLEY_FAIL_AT: "reload" });
  assert.notEqual(result.status, 0);
  assert.equal(commands(fixture).some((line) => line.includes("start ashley-agent")), false);
});

test("checkout identity is pinned through activation", () => {
  const fixture = createFixture();
  const result = runUpdate(fixture, { ASHLEY_FAKE_SHA: "deadbeefcafef00d" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /CHECKOUT_SHA=deadbeefcafef00d/);
  assert.match(result.stdout, /Activated checkout deadbeefcafef00d/);
});

test("probe qualifier refuses production Ashley unit names", () => {
  const result = spawnSync(
    BASH,
    [posix(path.join(ROOT, "deploy", "linux-mint", "qualify-coherent-activation.sh"))],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ASHLEY_SLICE_C_PROBE: "ashley-agent.service",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to use production Ashley unit/);
});

test("probe qualifier refuses production Ashley unit names", () => {
  const result = spawnSync(
    BASH,
    [posix(path.join(ROOT, "deploy", "linux-mint", "qualify-coherent-activation.sh"))],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ASHLEY_SLICE_C_PROBE: "ashley-agent.service",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to use production Ashley unit/);
});

// ---- Surgery A: impact-aware planning and activation ----

test("remote-update.ps1 pins exact candidate SHA/tree for Mint to enforce", () => {
  const source = readFileSync(path.join(ROOT, "scripts", "mint", "remote-update.ps1"), "utf8");
  assert.ok(source.includes("git rev-parse 'HEAD^{tree}'"), "tree revision must be single-quoted");
  assert.ok(source.includes("export ASHLEY_EXPECTED_SHA=$localSha"));
  assert.ok(source.includes("export ASHLEY_EXPECTED_TREE=$localTree"));
  const shaAt = source.indexOf("ASHLEY_EXPECTED_SHA=$localSha");
  const execAt = source.indexOf("exec bash deploy/linux-mint/update.sh");
  assert.ok(shaAt > 0 && shaAt < execAt, "expectation must precede the exec'd activator");
});

test("T1 planner: agent-service source builds only agent-service", () => {
  const fixture = createFixture();
  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tapps/agent-service/src/core/foo.ts"));
  assert.equal(plan.MODE, "impact_aware");
  assert.equal(plan.BUILD, "agent-service");
  assert.equal(plan.NPMCI, "");
  assert.equal(plan.STOP, "ashley-discord.service ashley-agent.service");
  assert.equal(plan.RESTART, "ashley-agent.service ashley-discord.service");
});

test("T1 agent-only deploy stops/restarts agent only and records activation", () => {
  const fixture = createFixture();
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tapps/agent-service/src/core/foo.ts");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(buildPackages(fixture), ["agent-service"]);
  assert.deepEqual(ciPackages(fixture), []);
  assert.ok(hasServiceOp(fixture, "stop", "ashley-discord.service"), "discord must fence ingress");
  assert.ok(hasServiceOp(fixture, "stop", "ashley-agent.service"));
  assert.ok(hasServiceOp(fixture, "start", "ashley-agent.service"));
  assert.ok(hasServiceOp(fixture, "start", "ashley-discord.service"));
  const lines = commands(fixture);
  const stopDiscordAt = firstIndex(lines, "stop ashley-discord.service");
  const stopAgentAt = firstIndex(lines, "stop ashley-agent.service");
  const startAgentAt = firstIndex(lines, "start ashley-agent.service");
  const readyAt = firstIndex(lines, "curl ");
  const startDiscordAt = firstIndex(lines, "start ashley-discord.service");
  assert.ok(stopDiscordAt >= 0 && stopAgentAt > stopDiscordAt, "stop discord before agent");
  assert.ok(startAgentAt > stopAgentAt, "start agent after stop");
  assert.ok(readyAt > startAgentAt, "agent ready before discord start");
  assert.ok(startDiscordAt > readyAt, "start discord after agent ready");
  assert.match(result.stdout, /mode: impact_aware/);
  assert.equal(readMarker(markerPath), SHA_B);
});

test("T2 discord-only deploy builds/restarts discord only", () => {
  const fixture = createFixture();
  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tapps/discord-bot/src/client.ts"));
  assert.equal(plan.BUILD, "discord-bot");
  assert.equal(plan.STOP, "ashley-discord.service");
  assert.equal(plan.RESTART, "ashley-discord.service");
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tapps/discord-bot/src/client.ts");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(buildPackages(fixture), ["discord-bot"]);
  assert.ok(!hasServiceOp(fixture, "stop", "ashley-agent.service"), "agent must keep running");
  assert.ok(!hasServiceOp(fixture, "start", "ashley-agent.service"));
  assert.ok(!hasServiceOp(fixture, "restart", "ashley-agent.service"));
  assert.equal(readMarker(markerPath), SHA_B);
});

test("T3 sandbox-v2 change builds v2 then agent, restarts agent only", () => {
  const fixture = createFixture();
  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tapps/sandbox-v2/src/dispatch.ts"));
  assert.equal(plan.BUILD, "sandbox-v2 agent-service");
  assert.equal(plan.STOP, "ashley-discord.service ashley-agent.service");
  assert.equal(plan.RESTART, "ashley-agent.service ashley-discord.service");
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tapps/sandbox-v2/src/dispatch.ts");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(buildPackages(fixture), ["sandbox-v2", "agent-service"]);
  assert.ok(hasServiceOp(fixture, "stop", "ashley-discord.service"), "discord fences ingress");
  assert.ok(hasServiceOp(fixture, "stop", "ashley-agent.service"));
  assert.equal(readMarker(markerPath), SHA_B);
});

test("T4 sandbox-policy change builds canonical closure without sandbox-m1", () => {
  const fixture = createFixture();
  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tapps/sandbox-policy/src/policy.ts"));
  assert.equal(plan.BUILD, "sandbox-policy sandbox-tree sandbox-v2 agent-service");
  assert.equal(plan.STOP, "ashley-discord.service ashley-agent.service");
  assert.equal(plan.RESTART, "ashley-agent.service ashley-discord.service");
  const { result } = runImpactedUpdate(fixture, SHA_A, "M\tapps/sandbox-policy/src/policy.ts");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(buildPackages(fixture), [
    "sandbox-policy",
    "sandbox-tree",
    "sandbox-v2",
    "agent-service",
  ]);
  assert.ok(hasServiceOp(fixture, "stop", "ashley-discord.service"), "discord fences ingress");
  assert.ok(hasServiceOp(fixture, "stop", "ashley-agent.service"));
});

test("T5 test-only change is a noop deploy with health still verified", () => {
  const fixture = createFixture();
  const plan = runPlanner(
    fixture,
    SHA_A,
    SHA_B,
    impactEnv(fixture, "M\tapps/agent-service/src/core/foo.test.ts"),
  );
  assert.equal(plan.MODE, "impact_aware");
  assert.equal(plan.BUILD, "");
  assert.equal(plan.NPMCI, "");
  assert.equal(plan.STOP, "");
  assert.equal(plan.RESTART, "");
  const { result, markerPath } = runImpactedUpdate(
    fixture,
    SHA_A,
    "M\tapps/agent-service/src/core/foo.test.ts",
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(commands(fixture).some((line) => line.startsWith("npm ")), false);
  assert.equal(commands(fixture).some((line) => / (stop|start|restart) ashley-/.test(line)), false);
  assert.ok(commands(fixture).some((line) => line.startsWith("curl ")), "health must still be verified");
  assert.equal(readMarker(markerPath), SHA_B);
});

test("T6 docs-only change is a noop deploy", () => {
  const fixture = createFixture();
  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tdocs/guide.md"));
  assert.equal(plan.MODE, "impact_aware");
  assert.equal(plan.BUILD, "");
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tdocs/guide.md");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(commands(fixture).some((line) => line.startsWith("npm ")), false);
  assert.equal(readMarker(markerPath), SHA_B);
});

test("T7 lockfile change installs only the affected package plus closure build", () => {
  const fixture = createFixture();
  const plan = runPlanner(
    fixture,
    SHA_A,
    SHA_B,
    impactEnv(fixture, "M\tapps/sandbox-v2/package-lock.json"),
  );
  assert.equal(plan.BUILD, "sandbox-v2 agent-service");
  assert.equal(plan.NPMCI, "sandbox-v2");
  const { result } = runImpactedUpdate(fixture, SHA_A, "M\tapps/sandbox-v2/package-lock.json");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(ciPackages(fixture), ["sandbox-v2"]);
  assert.deepEqual(buildPackages(fixture), ["sandbox-v2", "agent-service"]);
});

test("T8 unknown path falls back to the full broad deploy including npm ci x6", () => {
  const fixture = createFixture();
  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tsome/new/tool.bin"));
  assert.equal(plan.MODE, "full_fallback");
  assert.match(plan.FALLBACK_REASON, /unknown_path/);
  assert.equal(
    plan.BUILD,
    "sandbox-policy sandbox-m1 sandbox-tree sandbox-v2 agent-service discord-bot",
  );
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tsome/new/tool.bin");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /mode: full_fallback/);
  assert.deepEqual(buildPackages(fixture), [
    "sandbox-policy",
    "sandbox-m1",
    "sandbox-tree",
    "sandbox-v2",
    "agent-service",
    "discord-bot",
  ]);
  assert.equal(ciPackages(fixture).length, 6);
  assert.ok(hasServiceOp(fixture, "stop", "ashley-agent.service"));
  assert.ok(hasServiceOp(fixture, "stop", "ashley-discord.service"));
  assert.equal(readMarker(markerPath), SHA_B);
});

test("T9 missing marker falls back once, then records activation on success", () => {
  const fixture = createFixture();
  const before = runPlanner(fixture, "", SHA_B, impactEnv(fixture, ""));
  assert.equal(before.MODE, "full_fallback");
  assert.equal(before.FALLBACK_REASON, "marker_missing");
  // Default marker path (no override): $HOME/.composer-assistant/deploy/activated-sha.
  const result = runUpdate(fixture, impactEnv(fixture, ""));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(buildPackages(fixture), [
    "sandbox-policy",
    "sandbox-m1",
    "sandbox-tree",
    "sandbox-v2",
    "agent-service",
    "discord-bot",
  ]);
  const markerPath = path.join(fixture.home, ".composer-assistant", "deploy", "activated-sha");
  assert.equal(readMarker(markerPath), SHA_B);
});

test("T10 malformed, unknown, and non-ancestor markers all fall back safely", () => {
  const fixture = createFixture();
  assert.equal(
    runPlanner(fixture, "not-a-sha", SHA_B, impactEnv(fixture, "")).FALLBACK_REASON,
    "marker_malformed",
  );
  assert.equal(
    runPlanner(fixture, SHA_A, SHA_B, { ...impactEnv(fixture, ""), ASHLEY_FAKE_COMMITS: SHA_B })
      .FALLBACK_REASON,
    "marker_unknown_commit",
  );
  assert.equal(
    runPlanner(fixture, SHA_A, SHA_B, { ...impactEnv(fixture, ""), ASHLEY_FAKE_ANCESTOR: "0" })
      .FALLBACK_REASON,
    "marker_not_ancestor",
  );
  // A rerun with a non-ancestor marker still preserves the old marker value.
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "", { ASHLEY_FAKE_ANCESTOR: "0" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /mode: full_fallback/);
  assert.equal(readMarker(markerPath), SHA_B);
});

test("T11 interrupted deploy preserves marker A, rerun rebuilds full closure", () => {
  const fixture = createFixture();
  const diff = "M\tapps/sandbox-v2/src/dispatch.ts";
  const first = runImpactedUpdate(fixture, SHA_A, diff, { ASHLEY_FAIL_AT: "build" });
  assert.notEqual(first.result.status, 0);
  assert.equal(commands(fixture).some((line) => line.startsWith("npm ")), false);
  assert.equal(readMarker(first.markerPath), SHA_A);
  assert.equal(readFileSync(path.join(fixture.state, "ashley-agent.service"), "utf8").trim(), "inactive");
  const second = runImpactedUpdate(fixture, SHA_A, diff);
  assert.equal(second.result.status, 0, `${second.result.stdout}\n${second.result.stderr}`);
  assert.deepEqual(buildPackages(fixture), ["sandbox-v2", "agent-service"]);
  assert.equal(readMarker(second.markerPath), SHA_B);
});

test("T12 agent health failure preserves marker A", () => {
  const fixture = createFixture();
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tapps/agent-service/src/core/foo.ts", {
    ASHLEY_CURL_FAIL: "1",
  });
  assert.notEqual(result.status, 0);
  assert.ok(buildPackages(fixture).length > 0, "builds ran before the health gate");
  assert.equal(readMarker(markerPath), SHA_A);
});

test("T13 service start failure preserves marker A", () => {
  const fixture = createFixture();
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tapps/agent-service/src/core/foo.ts", {
    ASHLEY_FAKE_START_FAIL: "1",
  });
  assert.notEqual(result.status, 0);
  assert.equal(readMarker(markerPath), SHA_A);
});

test("T14 expected SHA/tree mismatch fails before any activation mutation", () => {
  const fixture = createFixture();
  const mismatch = runImpactedUpdate(fixture, null, "", {
    ASHLEY_EXPECTED_SHA: "d".repeat(40),
  });
  assert.notEqual(mismatch.result.status, 0);
  assert.match(mismatch.result.stderr, /expected SHA mismatch/);
  assert.equal(commands(fixture).some((line) => line.includes("stop ")), false);
  assert.equal(readMarker(mismatch.markerPath), null);
  const treeMismatch = runImpactedUpdate(fixture, null, "", {
    ASHLEY_EXPECTED_SHA: SHA_B,
    ASHLEY_EXPECTED_TREE: "e".repeat(40),
  });
  assert.notEqual(treeMismatch.result.status, 0);
  assert.match(treeMismatch.result.stderr, /expected tree mismatch/);
  // Matching expectation proceeds (fallback: no marker yet).
  const ok = runImpactedUpdate(fixture, null, "", {
    ASHLEY_EXPECTED_SHA: SHA_B,
    ASHLEY_EXPECTED_TREE: TREE_B,
  });
  assert.equal(ok.result.status, 0, `${ok.result.stdout}\n${ok.result.stderr}`);
});

test("T15/T16 already-activated target is a noop with health still verified", () => {
  const fixture = createFixture();
  const plan = runPlanner(fixture, SHA_B, SHA_B, impactEnv(fixture, ""));
  assert.equal(plan.MODE, "impact_aware");
  assert.equal(plan.BUILD, "");
  assert.equal(plan.NPMCI, "");
  assert.equal(plan.STOP, "");
  assert.equal(plan.RESTART, "");
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_B, "");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(commands(fixture).some((line) => line.startsWith("npm ")), false);
  assert.equal(commands(fixture).some((line) => / (stop|start|restart) ashley-/.test(line)), false);
  assert.ok(commands(fixture).some((line) => line.startsWith("curl ")), "health must still be verified");
  assert.match(result.stdout, /TARGET_SHA=/);
  assert.equal(readMarker(markerPath), SHA_B);
});

test("T17 every subset closure preserves canonical topological order", () => {
  const fixture = createFixture();
  const cases = [
    ["M\tapps/sandbox-m1/src/sandbox-m1.ts", "sandbox-m1 sandbox-v2 agent-service"],
    ["M\tapps/sandbox-tree/src/index.ts", "sandbox-tree sandbox-v2 agent-service"],
    ["M\tapps/sandbox-v2/src/index.ts", "sandbox-v2 agent-service"],
    ["M\tapps/discord-bot/src/index.ts", "discord-bot"],
  ];
  for (const [diff, want] of cases) {
    const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, diff));
    assert.equal(plan.BUILD, want, diff);
  }
});

test("T18 unit-only change restarts only the affected service with no build", () => {
  const fixture = createFixture();
  const plan = runPlanner(
    fixture,
    SHA_A,
    SHA_B,
    impactEnv(fixture, "M\tdeploy/linux-mint/systemd/ashley-discord.service"),
  );
  assert.equal(plan.MODE, "impact_aware");
  assert.equal(plan.BUILD, "");
  assert.equal(plan.STOP, "");
  assert.equal(plan.RESTART, "ashley-discord.service");
  const { result, markerPath } = runImpactedUpdate(
    fixture,
    SHA_A,
    "M\tdeploy/linux-mint/systemd/ashley-discord.service",
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(commands(fixture).some((line) => line.startsWith("npm ")), false);
  assert.ok(hasServiceOp(fixture, "restart", "ashley-discord.service"));
  assert.ok(!hasServiceOp(fixture, "stop", "ashley-agent.service"));
  assert.ok(!hasServiceOp(fixture, "start", "ashley-agent.service"));
  assert.ok(!hasServiceOp(fixture, "restart", "ashley-agent.service"));
  assert.equal(readMarker(markerPath), SHA_B);
});

test("T19 deletion and rename classify to the owning package closure", () => {
  const fixture = createFixture();
  const del = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "D\tapps/sandbox-tree/src/old.ts"));
  assert.equal(del.BUILD, "sandbox-tree sandbox-v2 agent-service");
  const ren = runPlanner(
    fixture,
    SHA_A,
    SHA_B,
    impactEnv(fixture, "R100\tapps/agent-service/src/a.ts\tapps/agent-service/src/b.ts"),
  );
  assert.equal(ren.BUILD, "agent-service");
});

test("T20 missing build output fails activation and preserves marker", () => {
  const fixture = createFixture();
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tapps/agent-service/src/core/foo.ts", {
    ASHLEY_NPM_SKIP_DIST: "1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing runtime artifact/);
  assert.equal(readMarker(markerPath), SHA_A);
});

test("T10b dirty tracked worktree fails closed before mutation", () => {
  const fixture = createFixture();
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tapps/agent-service/src/core/foo.ts", {
    ASHLEY_FAKE_DIRTY: "1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tracked worktree dirty/);
  assert.equal(commands(fixture).some((line) => line.includes("stop ")), false);
  assert.equal(readMarker(markerPath), SHA_A);
});

test("privacy-core and runtime config changes restart agent without a build", () => {
  const fixture = createFixture();
  const priv = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tpackages/privacy-core/index.js"));
  assert.equal(priv.BUILD, "");
  assert.equal(priv.STOP, "ashley-discord.service ashley-agent.service");
  assert.equal(priv.RESTART, "ashley-agent.service ashley-discord.service");
  const cfg = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tconfig/curiosity-sources.json"));
  assert.equal(cfg.BUILD, "");
  assert.equal(cfg.STOP, "ashley-discord.service ashley-agent.service");
  assert.equal(cfg.RESTART, "ashley-agent.service ashley-discord.service");
  const games = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tconfig/games.json"));
  assert.equal(games.BUILD, "");
  assert.equal(games.STOP, "");
  assert.equal(games.RESTART, "");
});

// ---- Release-critical witnesses for Blocker 1 (Graph Drift) and Blocker 2 (Ingress Fence) ----

test("W1 graph drift: target metadata introducing Y -> X builds Y when only X changes", () => {
  const fixture = createFixture();
  // Release B: discord-bot introduces local dependency on agent-service
  const discordPkgPath = path.join(fixture.repo, "apps", "discord-bot", "package.json");
  const discordPkg = JSON.parse(readFileSync(discordPkgPath, "utf8"));
  discordPkg.dependencies = {
    ...(discordPkg.dependencies || {}),
    "@composer-assistant/agent-service": "file:../agent-service",
  };
  writeFileSync(discordPkgPath, JSON.stringify(discordPkg, null, 2));

  // Also declare the import in discord-bot src so metadata completeness holds
  writeFileSync(
    path.join(fixture.repo, "apps", "discord-bot", "src", "index.ts"),
    'import "@composer-assistant/agent-service";\nexport const ok = true;\n',
  );

  // Release C: only X (apps/agent-service/src/core/foo.ts) changes
  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tapps/agent-service/src/core/foo.ts"));
  assert.equal(plan.MODE, "impact_aware");
  // Closure must include both agent-service and its dependent discord-bot
  assert.equal(plan.BUILD, "agent-service discord-bot");
  assert.equal(plan.STOP, "ashley-discord.service ashley-agent.service");
  assert.equal(plan.RESTART, "ashley-agent.service ashley-discord.service");
});

test("W2 undeclared cross-package dependency falls back to full_fallback", () => {
  const fixture = createFixture();
  // Target source introduces cross-package runtime dependency not in package.json
  writeFileSync(
    path.join(fixture.repo, "apps", "sandbox-m1", "src", "undeclared.ts"),
    'import { WorkspaceManager } from "@composer-assistant/sandbox-v2";\n',
  );

  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tapps/sandbox-m1/src/sandbox-m1.ts"));
  assert.equal(plan.MODE, "full_fallback");
  assert.match(plan.FALLBACK_REASON, /undeclared_cross_package_dependency/);
  assert.equal(plan.BUILD, CANONICAL_ORDER);
});

test("W3 malformed JSON in package metadata falls back to full_fallback", () => {
  const fixture = createFixture();
  writeFileSync(path.join(fixture.repo, "apps", "agent-service", "package.json"), "NOT_JSON{{{");
  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tapps/agent-service/src/core/foo.ts"));
  assert.equal(plan.MODE, "full_fallback");
  assert.match(plan.FALLBACK_REASON, /malformed_package_metadata/);
  assert.equal(plan.BUILD, CANONICAL_ORDER);
});

test("W4 unknown local package target falls back to full_fallback", () => {
  const fixture = createFixture();
  const pkgPath = path.join(fixture.repo, "apps", "sandbox-v2", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.dependencies["@composer-assistant/unknown-dep"] = "file:../unknown-dep";
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tapps/sandbox-v2/src/dispatch.ts"));
  assert.equal(plan.MODE, "full_fallback");
  assert.match(plan.FALLBACK_REASON, /unknown_local_package_target/);
  assert.equal(plan.BUILD, CANONICAL_ORDER);
});

test("W5 escaping local dependency path falls back to full_fallback", () => {
  const fixture = createFixture();
  const pkgPath = path.join(fixture.repo, "apps", "sandbox-v2", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.dependencies["@composer-assistant/escaping"] = "file:../../../../etc/passwd";
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tapps/sandbox-v2/src/dispatch.ts"));
  assert.equal(plan.MODE, "full_fallback");
  assert.match(plan.FALLBACK_REASON, /escaping_or_ambiguous_dependency_path/);
  assert.equal(plan.BUILD, CANONICAL_ORDER);
});

test("W6 dependency cycle or topology violation falls back to full_fallback", () => {
  const fixture = createFixture();
  // sandbox-policy is earlier than sandbox-v2; introducing policy -> v2 is backward/cycle
  const pkgPath = path.join(fixture.repo, "apps", "sandbox-policy", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.dependencies = {
    ...(pkg.dependencies || {}),
    "@composer-assistant/sandbox-v2": "file:../sandbox-v2",
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  const plan = runPlanner(fixture, SHA_A, SHA_B, impactEnv(fixture, "M\tapps/sandbox-policy/src/policy.ts"));
  assert.equal(plan.MODE, "full_fallback");
  assert.match(plan.FALLBACK_REASON, /dependency_cycle_or_topology_violation/);
  assert.equal(plan.BUILD, CANONICAL_ORDER);
});

test("W7 agent deploy fences Discord ingress: strict stop/start/ready order verified", () => {
  const fixture = createFixture();
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tapps/agent-service/src/core/foo.ts");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  // Build/ci counts: only agent-service built, 0 npm ci, discord NOT rebuilt
  assert.deepEqual(buildPackages(fixture), ["agent-service"]);
  assert.deepEqual(ciPackages(fixture), []);

  const lines = commands(fixture);
  const stopDiscordAt = firstIndex(lines, "stop ashley-discord.service");
  const stopAgentAt = firstIndex(lines, "stop ashley-agent.service");
  const buildAgentAt = lines.findIndex((line) => line.includes("npm run build") && line.includes("agent-service"));
  const startAgentAt = firstIndex(lines, "start ashley-agent.service");
  const readyHealthAt = firstIndex(lines, "curl ");
  const startDiscordAt = firstIndex(lines, "start ashley-discord.service");

  // Strict ordering assertions
  assert.ok(stopDiscordAt >= 0, "discord stop executed");
  assert.ok(stopAgentAt > stopDiscordAt, "discord stopped before agent");
  assert.ok(buildAgentAt > stopAgentAt, "agent built while stopped");
  assert.ok(startAgentAt > buildAgentAt, "agent started after build");
  assert.ok(readyHealthAt > startAgentAt, "agent health checked after agent start");
  assert.ok(startDiscordAt > readyHealthAt, "discord started only after agent ready");

  assert.equal(readMarker(markerPath), SHA_B);
});

test("W8 discord-only deploy leaves agent running undisturbed", () => {
  const fixture = createFixture();
  const { result, markerPath } = runImpactedUpdate(fixture, SHA_A, "M\tapps/discord-bot/src/client.ts");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  // Discord built, agent NOT built
  assert.deepEqual(buildPackages(fixture), ["discord-bot"]);

  // Agent was NEVER stopped, started, or restarted
  assert.equal(hasServiceOp(fixture, "stop", "ashley-agent.service"), false, "agent must not stop");
  assert.equal(hasServiceOp(fixture, "start", "ashley-agent.service"), false, "agent must not start");
  assert.equal(hasServiceOp(fixture, "restart", "ashley-agent.service"), false, "agent must not restart");

  // Discord stopped and started
  assert.equal(hasServiceOp(fixture, "stop", "ashley-discord.service"), true);
  assert.equal(hasServiceOp(fixture, "start", "ashley-discord.service"), true);

  assert.equal(readMarker(markerPath), SHA_B);
});

