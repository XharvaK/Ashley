/**
 * Embedded inline runner source for Sandbox V2 M3 candidate workspace experiments.
 */
export const SANDBOX_V2_WORKSPACE_RUNNER_SOURCE = `"use strict";

var fs = require("fs");
var crypto = require("crypto");
var net = require("net");

var WORKSPACE = "/workspace";
var WORKSPACE_MAX_BYTES = 100 * 1024 * 1024;
var REQUEST_MAX_BYTES = 128 * 1024;
var READ_MAX_BYTES = 64 * 1024;
var WRITE_MAX_BYTES = 64 * 1024;
var LIST_MAX_ENTRIES = 2000;
var SEARCH_PATTERN_MAX = 256;
var SEARCH_MAX_MATCHES = 2000;
var SEARCH_MAX_FILES = 2000;
var SEARCH_MAX_FILE_BYTES = 128 * 1024;
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
  process.stdout.write(JSON.stringify(obj) + NL);
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

function resolveSafe(rel) {
  if (rel === "." || rel === "") { return { ok: true, abs: WORKSPACE }; }
  if (!isCanonicalRelativePath(rel)) { return { ok: false, code: "invalid_path" }; }
  var parts = rel.split("/");
  var cur = WORKSPACE;
  for (var i = 0; i < parts.length; i += 1) {
    var segment = parts[i];
    if (segment === "" || segment === "." || segment === "..") { return { ok: false, code: "invalid_path" }; }
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

function resolveSafeParent(rel) {
  if (typeof rel !== "string" || rel === "." || rel === "" || !isCanonicalRelativePath(rel)) {
    return { ok: false, code: "invalid_path" };
  }
  var parts = rel.split("/");
  var fileName = parts[parts.length - 1];
  if (fileName === "" || fileName === "." || fileName === "..") {
    return { ok: false, code: "invalid_path" };
  }
  var cur = WORKSPACE;
  for (var i = 0; i < parts.length - 1; i += 1) {
    var segment = parts[i];
    if (segment === "" || segment === "." || segment === "..") { return { ok: false, code: "invalid_path" }; }
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
    if (!st.isDirectory()) {
      return { ok: false, code: "not_a_directory" };
    }
  }
  var parentAbs = cur;
  var targetAbs = parentAbs + "/" + fileName;
  return { ok: true, parentAbs: parentAbs, abs: targetAbs, fileName: fileName };
}

function ensureWithinWorkspace(abs) {
  var normalized;
  try {
    normalized = fs.realpathSync(abs);
  } catch (e) {
    return { ok: false };
  }
  var wsRoot = fs.realpathSync(WORKSPACE);
  if (normalized !== wsRoot && !normalized.startsWith(wsRoot + "/")) {
    return { ok: false };
  }
  return { ok: true };
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
    sock.setTimeout(2000, function () { done(false, "PROBE_CAP_EXPIRED"); });
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

// ---------- Operations ----------

function readFileOp(rel) {
  var resolved = resolveSafe(rel);
  if (!resolved.ok) { fail(resolved.code); }
  var abs = resolved.abs;
  var within = ensureWithinWorkspace(abs);
  if (!within.ok) { fail("path_escapes_workspace"); }
  var st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    fail("not_found");
  }
  if (st.isSymbolicLink()) { fail("symlink_forbidden"); }
  if (!st.isFile()) { fail("not_a_file"); }
  if (st.size > READ_MAX_BYTES) { fail("file_too_large"); }
  var buf;
  try {
    buf = fs.readFileSync(abs);
  } catch (e) {
    fail("read_failed");
  }
  return {
    kind: "workspace.read_file",
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
  var abs = resolved.abs;
  var within = ensureWithinWorkspace(abs);
  if (!within.ok) { fail("path_escapes_workspace"); }
  var st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    fail("not_found");
  }
  if (st.isSymbolicLink()) { fail("symlink_forbidden"); }
  if (!st.isDirectory()) { fail("not_a_directory"); }
  var names;
  try {
    names = fs.readdirSync(abs).sort();
  } catch (e) {
    fail("readdir_failed");
  }
  var truncated = names.length > LIST_MAX_ENTRIES;
  var limit = Math.min(names.length, LIST_MAX_ENTRIES);
  var entries = [];
  for (var i = 0; i < limit; i += 1) {
    var name = names[i];
    var entryAbs = abs + "/" + name;
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
  return { kind: "workspace.list_directory", path: rel, entries: entries, truncated: truncated };
}

function searchOp(rel, pattern, maxMatches) {
  var resolved = resolveSafe(rel);
  if (!resolved.ok) { fail(resolved.code); }
  var abs = resolved.abs;
  var within = ensureWithinWorkspace(abs);
  if (!within.ok) { fail("path_escapes_workspace"); }
  var st;
  try {
    st = fs.lstatSync(abs);
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
      var abs2 = dir + "/" + entry.name;
      var childRel = relPath === "" ? entry.name : relPath + "/" + entry.name;
      if (entry.isDirectory()) {
        if (SEARCH_EXCLUDED_DIRS[entry.name]) { continue; }
        walk(abs2, childRel, depth + 1);
      } else if (entry.isFile()) {
        filesScanned += 1;
        var fst;
        try {
          fst = fs.statSync(abs2);
        } catch (e) {
          continue;
        }
        if (fst.size > SEARCH_MAX_FILE_BYTES) { continue; }
        var content;
        try {
          content = fs.readFileSync(abs2, "utf8");
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
  walk(abs, startRel, 0);
  return {
    kind: "workspace.search_text",
    path: rel,
    matches: matches,
    truncated: truncated,
    filesScanned: filesScanned
  };
}

function computeWorkspaceBytes() {
  var total = 0;
  function walk(dir) {
    var entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i];
      if (entry.isSymbolicLink()) { continue; }
      var full = dir + "/" + entry.name;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        try {
          var st = fs.statSync(full);
          total += st.size;
        } catch (e) {}
      }
    }
  }
  walk(WORKSPACE);
  return total;
}

function writeFileOp(req) {
  var path = req.path;
  var resolved = resolveSafeParent(path);
  if (!resolved.ok) { fail(resolved.code); }
  var parentAbs = resolved.parentAbs;
  var abs = resolved.abs;
  var within = ensureWithinWorkspace(parentAbs);
  if (!within.ok) { fail("path_escapes_workspace"); }
  var st;
  var exists = false;
  try {
    st = fs.lstatSync(abs);
    exists = true;
  } catch (e) {}
  if (exists) {
    if (st.isSymbolicLink()) { fail("symlink_forbidden"); }
    fail("file_exists");
  }
  var byteLen = Buffer.byteLength(req.content, "utf8");
  if (byteLen > WRITE_MAX_BYTES) { fail("content_too_large"); }
  var curBytes = computeWorkspaceBytes();
  if (curBytes + byteLen > WORKSPACE_MAX_BYTES) { fail("workspace_limit_exceeded"); }

  var tmpAbs = parentAbs + "/.tmp." + Date.now() + "." + crypto.randomBytes(4).toString("hex");
  try {
    fs.writeFileSync(tmpAbs, req.content, "utf8");
    fs.renameSync(tmpAbs, abs);
  } catch (e) {
    try { fs.unlinkSync(tmpAbs); } catch {}
    fail("write_failed");
  }
  var finalSt;
  try {
    finalSt = fs.lstatSync(abs);
  } catch (e) {
    try { fs.unlinkSync(tmpAbs); } catch {}
    fail("verify_failed");
  }
  if (finalSt.isSymbolicLink()) { fail("symlink_forbidden_after_write"); }
  var finalWithin = ensureWithinWorkspace(abs);
  if (!finalWithin.ok) { fail("path_escapes_workspace"); }
  return {
    kind: "workspace.write_file",
    path: path,
    bytesWritten: byteLen,
    contentHash: crypto.createHash("sha256").update(req.content, "utf8").digest("hex"),
    readMatches: true,
    deleted: false,
    verifiedAbsent: false,
    completedAtMs: Date.now()
  };
}

function replaceFileOp(req) {
  var path = req.path;
  var resolved = resolveSafe(path);
  if (!resolved.ok) { fail(resolved.code); }
  var abs = resolved.abs;
  var within = ensureWithinWorkspace(abs);
  if (!within.ok) { fail("path_escapes_workspace"); }
  var st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    fail("file_not_found");
  }
  if (st.isSymbolicLink()) { fail("symlink_forbidden"); }
  if (!st.isFile()) { fail("not_a_file"); }
  var existingBuf;
  try {
    existingBuf = fs.readFileSync(abs);
  } catch (e) {
    fail("read_failed");
  }
  var existingHash = crypto.createHash("sha256").update(existingBuf).digest("hex");
  if (existingHash !== req.expectedSha256) { fail("hash_mismatch"); }

  var byteLen = Buffer.byteLength(req.content, "utf8");
  if (byteLen > WRITE_MAX_BYTES) { fail("content_too_large"); }
  var delta = byteLen - st.size;
  if (delta > 0) {
    var curBytes = computeWorkspaceBytes();
    if (curBytes + delta > WORKSPACE_MAX_BYTES) { fail("workspace_limit_exceeded"); }
  }

  var tmpAbs = abs + ".tmp." + Date.now() + "." + crypto.randomBytes(4).toString("hex");
  try {
    fs.writeFileSync(tmpAbs, req.content, "utf8");
    fs.renameSync(tmpAbs, abs);
  } catch (e) {
    try { fs.unlinkSync(tmpAbs); } catch {}
    fail("write_failed");
  }
  var finalSt;
  try {
    finalSt = fs.lstatSync(abs);
  } catch (e) {
    fail("verify_failed");
  }
  if (finalSt.isSymbolicLink()) { fail("symlink_forbidden_after_write"); }
  return {
    kind: "workspace.replace_file",
    path: path,
    bytesWritten: byteLen,
    contentHash: crypto.createHash("sha256").update(req.content, "utf8").digest("hex"),
    readMatches: true,
    deleted: false,
    verifiedAbsent: false,
    completedAtMs: Date.now()
  };
}

function editTextOp(req) {
  var path = req.path;
  var resolved = resolveSafe(path);
  if (!resolved.ok) { fail(resolved.code); }
  var abs = resolved.abs;
  var within = ensureWithinWorkspace(abs);
  if (!within.ok) { fail("path_escapes_workspace"); }
  var st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    fail("file_not_found");
  }
  if (st.isSymbolicLink()) { fail("symlink_forbidden"); }
  if (!st.isFile()) { fail("not_a_file"); }
  var existing;
  try {
    existing = fs.readFileSync(abs, "utf8");
  } catch (e) {
    fail("read_failed");
  }
  var existingHash = crypto.createHash("sha256").update(existing, "utf8").digest("hex");
  if (existingHash !== req.expectedSha256) { fail("hash_mismatch"); }

  var count = 0;
  var lastIndex = -1;
  var searchStart = 0;
  while (true) {
    var idx = existing.indexOf(req.oldText, searchStart);
    if (idx < 0) { break; }
    count += 1;
    lastIndex = idx;
    searchStart = idx + req.oldText.length;
    if (count > 1) { fail("ambiguous_matches"); }
  }
  if (count === 0) { fail("no_matches"); }
  var newContent = existing.replace(req.oldText, req.newText);
  var byteLen = Buffer.byteLength(newContent, "utf8");
  if (byteLen > WRITE_MAX_BYTES) { fail("content_too_large"); }
  var delta = byteLen - st.size;
  if (delta > 0) {
    var curBytes = computeWorkspaceBytes();
    if (curBytes + delta > WORKSPACE_MAX_BYTES) { fail("workspace_limit_exceeded"); }
  }

  var tmpAbs = abs + ".tmp." + Date.now() + "." + crypto.randomBytes(4).toString("hex");
  try {
    fs.writeFileSync(tmpAbs, newContent, "utf8");
    fs.renameSync(tmpAbs, abs);
  } catch (e) {
    try { fs.unlinkSync(tmpAbs); } catch {}
    fail("write_failed");
  }
  var finalSt;
  try {
    finalSt = fs.lstatSync(abs);
  } catch (e) {
    fail("verify_failed");
  }
  if (finalSt.isSymbolicLink()) { fail("symlink_forbidden_after_write"); }
  return {
    kind: "workspace.edit_text",
    path: path,
    bytesWritten: byteLen,
    contentHash: crypto.createHash("sha256").update(newContent, "utf8").digest("hex"),
    readMatches: true,
    deleted: false,
    verifiedAbsent: false,
    completedAtMs: Date.now()
  };
}

function deleteFileOp(path, expectedSha256) {
  var resolved = resolveSafe(path);
  if (!resolved.ok) { fail(resolved.code); }
  var abs = resolved.abs;
  var within = ensureWithinWorkspace(abs);
  if (!within.ok) { fail("path_escapes_workspace"); }
  var st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    fail("file_not_found");
  }
  if (st.isSymbolicLink()) { fail("symlink_forbidden"); }
  if (!st.isFile()) { fail("not_a_file"); }
  if (typeof expectedSha256 === "string" && expectedSha256.length === 64) {
    var existingBuf;
    try { existingBuf = fs.readFileSync(abs); } catch (e) { fail("read_failed"); }
    var existingHash = crypto.createHash("sha256").update(existingBuf).digest("hex");
    if (existingHash !== expectedSha256) { fail("hash_mismatch"); }
  }
  try {
    fs.unlinkSync(abs);
  } catch (e) {
    fail("delete_failed");
  }
  var exists = false;
  try {
    fs.lstatSync(abs);
    exists = true;
  } catch (e) {}
  if (exists) { fail("still_exists"); }
  return {
    kind: "workspace.delete_file",
    path: path,
    deleted: true,
    verifiedAbsent: true,
    completedAtMs: Date.now()
  };
}

function createDirectoryOp(path) {
  if (typeof path !== "string" || path === "." || path === "" || !isCanonicalRelativePath(path)) {
    fail("invalid_path");
  }
  var parts = path.split("/");
  var cur = WORKSPACE;
  for (var i = 0; i < parts.length; i += 1) {
    var segment = parts[i];
    if (segment === "" || segment === "." || segment === "..") { fail("invalid_path"); }
    cur = cur + "/" + segment;
    var exists = false;
    var st;
    try {
      st = fs.lstatSync(cur);
      exists = true;
    } catch (e) {}
    if (exists) {
      if (st.isSymbolicLink()) { fail("symlink_forbidden"); }
      if (!st.isDirectory()) { fail("not_a_directory"); }
    } else {
      try {
        fs.mkdirSync(cur);
      } catch (e) {
        fail("mkdir_failed");
      }
    }
  }
  var dirSt;
  try {
    dirSt = fs.lstatSync(cur);
  } catch (e) {
    fail("verify_failed");
  }
  if (dirSt.isSymbolicLink()) { fail("symlink_forbidden"); }
  if (!dirSt.isDirectory()) { fail("not_a_directory"); }
  var within = ensureWithinWorkspace(cur);
  if (!within.ok) { fail("path_escapes_workspace"); }
  return {
    kind: "workspace.create_directory",
    path: path,
    created: true,
    completedAtMs: Date.now()
  };
}

// Search exclusions for M3 (same pattern as V2 view)
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
  if (req.operation === "workspace.read_file") {
    if (typeof req.path !== "string") { fail("bad-request"); }
    result = readFileOp(req.path);
  } else if (req.operation === "workspace.list_directory") {
    if (typeof req.path !== "string") { fail("bad-request"); }
    result = listDirOp(req.path);
  } else if (req.operation === "workspace.search_text") {
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
  } else if (req.operation === "workspace.write_file") {
    if (typeof req.path !== "string") { fail("bad-request"); }
    if (typeof req.content !== "string") { fail("bad-request"); }
    if (typeof req.mustNotExist !== "boolean") { fail("bad-request"); }
    result = writeFileOp(req);
  } else if (req.operation === "workspace.replace_file") {
    if (typeof req.path !== "string") { fail("bad-request"); }
    if (typeof req.content !== "string") { fail("bad-request"); }
    if (typeof req.expectedSha256 !== "string" || req.expectedSha256.length !== 64) { fail("bad-request"); }
    result = replaceFileOp(req);
  } else if (req.operation === "workspace.edit_text") {
    if (typeof req.path !== "string") { fail("bad-request"); }
    if (typeof req.oldText !== "string") { fail("bad-request"); }
    if (typeof req.newText !== "string") { fail("bad-request"); }
    if (typeof req.expectedSha256 !== "string" || req.expectedSha256.length !== 64) { fail("bad-request"); }
    result = editTextOp(req);
  } else if (req.operation === "workspace.delete_file") {
    if (typeof req.path !== "string") { fail("bad-request"); }
    result = deleteFileOp(req.path, req.expectedSha256);
  } else if (req.operation === "workspace.create_directory") {
    if (typeof req.path !== "string") { fail("bad-request"); }
    result = createDirectoryOp(req.path);
  } else {
    fail("unsupported_operation");
  }

  var checks = {
    envClean: false,
    homeAbsent: false,
    runAbsent: false,
    hostSentinelAbsent: false,
    fdClean: false,
    workspaceWritable: false,
    usrReadOnly: false,
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
    process.env.PWD === WORKSPACE &&
    process.env.ASHLEY_SANDBOX_V2_SECRET_SENTINEL === undefined;

  var usrWritable = false;
  try {
    fs.writeFileSync("/usr/.v3-probe", "x");
    usrWritable = true;
    try { fs.unlinkSync("/usr/.v3-probe"); } catch (e) {}
  } catch (e) {}
  checks.usrReadOnly = !usrWritable;

  var wsWritable = false;
  var probeFile = WORKSPACE + "/.v3-probe-" + process.pid + "-" + Date.now();
  try {
    fs.writeFileSync(probeFile, "x");
    wsWritable = true;
    try { fs.unlinkSync(probeFile); } catch (e) {}
  } catch (e) {}
  checks.workspaceWritable = wsWritable;

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
    checks.hostSentinelAbsent && checks.fdClean && checks.workspaceWritable && checks.usrReadOnly;
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