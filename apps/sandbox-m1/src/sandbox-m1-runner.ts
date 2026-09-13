/**
 * Frozen inline runner source for Ashley Sandbox V2 M1.
 *
 * This module contains NO logic of its own: it exports the runner as a
 * string constant that the host launcher embeds verbatim as the bwrap
 * COMMAND (`/opt/node/bin/node -e <source>`).
 *
 * The source is CommonJS (the disposable /workspace contains no package.json,
 * so `node -e` evaluates as CJS). It must not contain backticks, `${`, or
 * backslashes: it lives inside a TypeScript template literal.
 *
 * Contract (locked by ASHLEY_SANDBOX_V2_FINAL_PRE-M0_ADR + M0/M0.1 packets):
 *  - stdin: exactly one UTF-8 JSON request (version 1, kind file.roundtrip);
 *  - stdout: exactly one UTF-8 JSON evidence document (nothing else);
 *  - stderr: diagnostics only, never parsed as a result;
 *  - exit 0 on runner-side success, 1 on any failure (fail closed).
 */
export const SANDBOX_M1_RUNNER_SOURCE = `"use strict";
const fs = require("fs");
const net = require("net");

const FILE = "/workspace/hello.txt";
const PROBE_CAP_MS = 2000;
const REQUEST_MAX_BYTES = 4096;
const ALLOWED_EXTERNAL = ["ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL", "EACCES", "EPERM"];

function emit(obj) {
  fs.writeSync(1, JSON.stringify(obj) + String.fromCharCode(10));
}

function fail(code) {
  emit({ version: 1, kind: "file.roundtrip", ok: false, code: code });
  process.exit(1);
}

function readStdin() {
  return new Promise(function (resolve) {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", function (chunk) {
      data += chunk;
      if (data.length > REQUEST_MAX_BYTES) {
        process.stdin.destroy();
        fail("stdin-overflow");
      }
    });
    process.stdin.on("end", function () { resolve(data); });
  });
}

function probe(port, host) {
  return new Promise(function (resolve) {
    const sock = new net.Socket();
    let settled = false;
    function done(ok, err) {
      if (settled) { return; }
      settled = true;
      sock.destroy();
      resolve({ ok: ok, err: err });
    }
    sock.setTimeout(PROBE_CAP_MS, function () { done(false, "PROBE_CAP_EXPIRED"); });
    sock.once("connect", function () { done(true, ""); });
    sock.once("error", function (e) { done(false, e.code || String(e)); });
    sock.connect(port, host);
  });
}

function inaccessible(target) {
  try {
    fs.accessSync(target);
    return false;
  } catch (e) {
    return true;
  }
}

async function main() {
  let req;
  try {
    req = JSON.parse(await readStdin());
  } catch (e) {
    fail("bad-request");
  }
  if (!req || req.version !== 1 || req.kind !== "file.roundtrip" ||
      typeof req.content !== "string" ||
      !Number.isInteger(req.probePort) || req.probePort <= 0 ||
      typeof req.sentinelPath !== "string" ||
      typeof req.fdSentinelCanonical !== "string") {
    fail("bad-request");
  }

  const checks = {
    roundtrip: false,
    deleted: false,
    absent: false,
    homeAbsent: false,
    runAbsent: false,
    hostSentinelAbsent: false,
    envClean: false,
    fdClean: false
  };

  try { fs.writeFileSync(FILE, req.content, "utf8"); } catch (e) {}
  try { checks.roundtrip = fs.readFileSync(FILE, "utf8") === req.content; } catch (e) {}
  try { fs.unlinkSync(FILE); checks.deleted = true; } catch (e) {}
  checks.absent = !fs.existsSync(FILE);

  checks.homeAbsent = inaccessible("/home");
  checks.runAbsent = inaccessible("/run");
  checks.hostSentinelAbsent = inaccessible(req.sentinelPath);

  checks.envClean =
    Object.keys(process.env).length === 3 &&
    process.env.HOME === "/tmp" &&
    process.env.PATH === "/usr/bin" &&
    process.env.PWD === "/workspace" &&
    process.env.ASHLEY_SANDBOX_M1_SECRET_SENTINEL === undefined;

  try {
    const fds = fs.readdirSync("/proc/self/fd");
    let leak = false;
    for (let i = 0; i < fds.length; i++) {
      try {
        if (fs.realpathSync("/proc/self/fd/" + fds[i]) === req.fdSentinelCanonical) {
          leak = true;
          break;
        }
      } catch (e) {}
    }
    checks.fdClean = !leak;
  } catch (e) {}

  const loop = await probe(req.probePort, "127.0.0.1");
  const ext = await probe(80, "1.1.1.1");
  const externalIsolated = !ext.ok && ALLOWED_EXTERNAL.indexOf(ext.err) !== -1;

  const evidence = {
    version: 1,
    kind: "file.roundtrip",
    ok: true,
    checks: checks,
    loopbackConnectSucceeded: loop.ok,
    loopbackError: loop.err,
    externalIsolated: externalIsolated,
    externalError: ext.err
  };

  if (loop.ok) { fail("loopback-leak"); }
  const runnerOk = externalIsolated &&
    Object.keys(checks).every(function (k) { return checks[k] === true; });
  if (!runnerOk) {
    process.stderr.write(JSON.stringify(evidence) + String.fromCharCode(10));
    fail("check-failed");
  }

  emit(evidence);
  process.exit(0);
}

main().catch(function () { fail("internal-error"); });
`;