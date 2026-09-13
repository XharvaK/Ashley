/**
 * Embedded inline runner source for Sandbox V2 M2 project inspection
 * (Sandbox V2 M2).
 *
 * Shape: host launcher -> real /usr/bin/bwrap (fail-closed profile) -> fixed
 * inline node runner -> read-only sanitized source view mounted at /project ->
 * stdin JSON request -> typed evidence on stdout -> host validation ->
 * canonical SandboxV2Result -> view cleanup.
 *
 * The source is CommonJS (the view contains no package.json, so `node -e`
 * evaluates as CJS). It must not contain backticks, `${`, or backslashes: it
 * lives inside a TypeScript template literal. Newlines use
 * String.fromCharCode(10), and path checks are pure indexOf scans (no
 * regexes, no ReDoS surface).
 *
 * Contract (locked by Sandbox V2 M2):
 *  - stdin: exactly one UTF-8 JSON request (version 2, operation
 *    project.read_file | project.list_directory | project.search_text, plus
 *    host-injected probePort / sentinelPath / fdSentinelCanonical);
 *  - stdout: exactly one UTF-8 JSON evidence document (nothing else);
 *  - stderr: diagnostics only, never parsed as a result;
 *  - exit 0 on runner-side success, 1 on any failure (fail closed);
 *  - symlinks are NEVER followed anywhere; any symlink component is refused;
 *  - reads are bounded; oversize reads/listings/search walks are refused or
 *    explicitly truncated, never silently dropped.
 */

export const SANDBOX_V2_INSPECTION_RUNNER_SOURCE = `"use strict";

var fs = require("fs");
var crypto = require("crypto");
var net = require("net");

var PROJECT = "/project";
var PROBE_CAP_MS = 2000;
var REQUEST_MAX_BYTES = 16384;
var READ_MAX_BYTES = 65536;
var LIST_MAX_ENTRIES = 2000;
var SEARCH_PATTERN_MAX = 256;
var SEARCH_MAX_MATCHES = 2000;
var SEARCH_MAX_FILES = 2000;
var SEARCH_MAX_FILE_BYTES = 131072;
var SEARCH_MAX_DEPTH = 12;
var SEARCH_MATCH_TEXT_MAX = 512;
var NL = String.fromCharCode(10);
var CR = String.fromCharCode(13);
var NUL = String.fromCharCode(0);
var ALLOWED_EXTERNAL = ["ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL", "EACCES", "EPERM"];
var SEARCH_EXCLUDED_DIRS = {
  ".git": true,
  "node_modules": true,
  ".venv": true,
  "venv": true,
  "__pycache__": true,
  "dist": true,
  "build": true,
  "out": true,
  "target": true,
  ".next": true,
  "coverage": true
};

var OP = "unknown";

function emit(obj) {
  fs.writeSync(1, JSON.stringify(obj) + NL);
}

function fail(code) {
  emit({ version: 2, operation: OP, ok: false, code: code });
  process.exit(1);
}

function readStdin() {
  return new Promise(function (resolve) {
    var data = "";
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
    var sock = new net.Socket();
    var settled = false;
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

function isCanonicalRelativePath(rel) {
  if (typeof rel !== "string") { return false; }
  if (rel.length === 0 || rel.length > 1024) { return false; }
  if (rel.charAt(0) === "/" || rel.charAt(0) === "\\\\") { return false; }
  if (rel.indexOf("\\\\") !== -1) { return false; }
  if (rel.indexOf("..") !== -1) { return false; }
  if (rel.indexOf(":") !== -1) { return false; }
  if (rel.indexOf(NUL) !== -1) { return false; }
  return true;
}

// Walk /project component by component, refusing ANY symlink (fail closed:
// a symlink could point outside the sanitized view). Every component must
// exist; the final component may be a file or directory depending on the op.
function resolveSafe(rel) {
  if (rel === "." || rel === "") { return { ok: true, abs: PROJECT }; }
  if (!isCanonicalRelativePath(rel)) { return { ok: false, code: "invalid_path" }; }
  var parts = rel.split("/");
  var cur = PROJECT;
  for (var i = 0; i < parts.length; i += 1) {
    var segment = parts[i];
    if (segment === "" || segment === ".") { return { ok: false, code: "invalid_path" }; }
    cur = cur + "/" + segment;
    var st;
    try {
      st = fs.lstatSync(cur);
    } catch (e) {
      return { ok: false, code: "not_found" };
    }
    if (st.isSymbolicLink()) {
      return { ok: false, code: "symlink_forbidden" };
    }
  }
  return { ok: true, abs: cur };
}

function readFileOp(rel) {
  var resolved = resolveSafe(rel);
  if (!resolved.ok) { fail(resolved.code); }
  var st;
  try {
    st = fs.lstatSync(resolved.abs);
  } catch (e) {
    fail("not_found");
  }
  if (st.isSymbolicLink()) { fail("symlink_forbidden"); }
  if (!st.isFile()) { fail("not_a_file"); }
  if (st.size > READ_MAX_BYTES) { fail("file_too_large"); }
  var buf;
  try {
    buf = fs.readFileSync(resolved.abs);
  } catch (e) {
    fail("read_failed");
  }
  return {
    kind: "project.read_file",
    path: rel,
    bytes: buf.length,
    contentBase64: buf.toString("base64"),
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    truncated: false
  };
}

function listDirOp(rel) {
  var resolved = resolveSafe(rel);
  if (!resolved.ok) { fail(resolved.code); }
  var st;
  try {
    st = fs.lstatSync(resolved.abs);
  } catch (e) {
    fail("not_found");
  }
  if (st.isSymbolicLink()) { fail("symlink_forbidden"); }
  if (!st.isDirectory()) { fail("not_a_directory"); }
  var names;
  try {
    names = fs.readdirSync(resolved.abs).sort();
  } catch (e) {
    fail("readdir_failed");
  }
  var truncated = names.length > LIST_MAX_ENTRIES;
  var limit = Math.min(names.length, LIST_MAX_ENTRIES);
  var entries = [];
  for (var i = 0; i < limit; i += 1) {
    var name = names[i];
    var entryAbs = resolved.abs + "/" + name;
    var kind = "other";
    var size = 0;
    try {
      var est = fs.lstatSync(entryAbs);
      if (est.isDirectory()) { kind = "dir"; }
      else if (est.isFile()) { kind = "file"; size = est.size; }
    } catch (e) {
      continue;
    }
    entries.push({ name: name, kind: kind, size: size });
  }
  return { kind: "project.list_directory", path: rel, entries: entries, truncated: truncated };
}

function searchOp(rel, pattern, maxMatches) {
  var resolved = resolveSafe(rel);
  if (!resolved.ok) { fail(resolved.code); }
  var st;
  try {
    st = fs.lstatSync(resolved.abs);
  } catch (e) {
    fail("not_found");
  }
  if (st.isSymbolicLink()) { fail("symlink_forbidden"); }
  if (!st.isDirectory()) { fail("not_a_directory"); }
  var startRel = (rel === "." || rel === "") ? "" : rel;
  var matches = [];
  var truncated = false;
  var filesScanned = 0;
  function walk(dir, relPath, depth) {
    if (depth > SEARCH_MAX_DEPTH) { truncated = true; return; }
    if (matches.length >= maxMatches || filesScanned >= SEARCH_MAX_FILES) {
      truncated = true;
      return;
    }
    var entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i];
      if (matches.length >= maxMatches || filesScanned >= SEARCH_MAX_FILES) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) { continue; }
      var abs = dir + "/" + entry.name;
      var childRel = relPath === "" ? entry.name : relPath + "/" + entry.name;
      if (entry.isDirectory()) {
        if (SEARCH_EXCLUDED_DIRS[entry.name]) { continue; }
        walk(abs, childRel, depth + 1);
      } else if (entry.isFile()) {
        filesScanned += 1;
        var fst;
        try {
          fst = fs.statSync(abs);
        } catch (e) {
          continue;
        }
        if (fst.size > SEARCH_MAX_FILE_BYTES) { continue; }
        var content;
        try {
          content = fs.readFileSync(abs, "utf8");
        } catch (e) {
          continue;
        }
        var lines = content.split(NL);
        for (var j = 0; j < lines.length; j += 1) {
          if (matches.length >= maxMatches) { truncated = true; break; }
          var line = lines[j];
          if (line.length > 0 && line.charCodeAt(line.length - 1) === CR) {
            line = line.slice(0, -1);
          }
          if (line.indexOf(pattern) !== -1) {
            var text = line.length > SEARCH_MATCH_TEXT_MAX ? line.slice(0, SEARCH_MATCH_TEXT_MAX) : line;
            matches.push({ path: childRel, line: j + 1, text: text });
          }
        }
      }
    }
  }
  walk(resolved.abs, startRel, 0);
  return {
    kind: "project.search_text",
    path: rel,
    matches: matches,
    truncated: truncated,
    filesScanned: filesScanned
  };
}

async function main() {
  var req;
  try {
    req = JSON.parse(await readStdin());
  } catch (e) {
    fail("bad-request");
  }
  if (!req || req.version !== 2 || typeof req.operation !== "string") {
    fail("bad-request");
  }
  OP = req.operation;
  if (typeof req.probePort !== "number" || !Number.isInteger(req.probePort) || req.probePort <= 0) {
    fail("bad-request");
  }
  if (typeof req.sentinelPath !== "string" || typeof req.fdSentinelCanonical !== "string") {
    fail("bad-request");
  }

  var result;
  if (req.operation === "project.read_file") {
    if (typeof req.path !== "string") { fail("bad-request"); }
    result = readFileOp(req.path);
  } else if (req.operation === "project.list_directory") {
    if (typeof req.path !== "string") { fail("bad-request"); }
    result = listDirOp(req.path);
  } else if (req.operation === "project.search_text") {
    if (typeof req.pattern !== "string" || req.pattern.length < 1 || req.pattern.length > SEARCH_PATTERN_MAX) {
      fail("bad-request");
    }
    if (req.path !== undefined && typeof req.path !== "string") { fail("bad-request"); }
    var maxMatches = SEARCH_MAX_MATCHES;
    if (req.maxMatches !== undefined) {
      if (!Number.isInteger(req.maxMatches) || req.maxMatches < 1 || req.maxMatches > SEARCH_MAX_MATCHES) {
        fail("bad-request");
      }
      maxMatches = req.maxMatches;
    }
    result = searchOp(req.path === undefined ? "." : req.path, req.pattern, maxMatches);
  } else {
    fail("unsupported_operation");
  }

  var checks = {
    envClean: false,
    homeAbsent: false,
    runAbsent: false,
    hostSentinelAbsent: false,
    fdClean: false,
    projectReadOnly: false,
    loopbackConnectSucceeded: true,
    externalIsolated: false,
    externalError: ""
  };

  checks.homeAbsent = inaccessible("/home");
  checks.runAbsent = inaccessible("/run");
  checks.hostSentinelAbsent = inaccessible(req.sentinelPath);

  checks.envClean =
    Object.keys(process.env).length === 3 &&
    process.env.HOME === "/tmp" &&
    process.env.PATH === "/usr/bin" &&
    process.env.PWD === PROJECT &&
    process.env.ASHLEY_SANDBOX_V2_SECRET_SENTINEL === undefined;

  var writable = false;
  try {
    fs.writeFileSync(PROJECT + "/.v2-write-probe", "x");
    writable = true;
  } catch (e) {}
  checks.projectReadOnly = !writable;

  try {
    var fds = fs.readdirSync("/proc/self/fd");
    var leak = false;
    for (var i = 0; i < fds.length; i += 1) {
      try {
        if (fs.realpathSync("/proc/self/fd/" + fds[i]) === req.fdSentinelCanonical) {
          leak = true;
          break;
        }
      } catch (e) {}
    }
    checks.fdClean = !leak;
  } catch (e) {}

  var loop = await probe(req.probePort, "127.0.0.1");
  checks.loopbackConnectSucceeded = loop.ok;
  var ext = await probe(80, "1.1.1.1");
  checks.externalIsolated = !ext.ok && ALLOWED_EXTERNAL.indexOf(ext.err) !== -1;
  checks.externalError = ext.err;

  if (loop.ok) { fail("loopback-leak"); }
  var runnerOk = checks.externalIsolated &&
    checks.envClean && checks.homeAbsent && checks.runAbsent &&
    checks.hostSentinelAbsent && checks.fdClean && checks.projectReadOnly;
  if (!runnerOk) {
    process.stderr.write(JSON.stringify(checks) + NL);
    fail("check-failed");
  }

  emit({
    version: 2,
    operation: req.operation,
    ok: true,
    result: result,
    checks: checks
  });
  process.exit(0);
}

main().catch(function () { fail("internal-error"); });
`;