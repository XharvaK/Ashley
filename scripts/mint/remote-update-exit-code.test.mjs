import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WRAPPER = path.join(ROOT, "scripts", "mint", "remote-update.ps1");
const isWindows = process.platform === "win32";
const skip = isWindows ? false : "windows-only wrapper semantics (powershell.exe + cmd stub)";

function source() {
  return readFileSync(WRAPPER, "utf8");
}

test("Invoke-MintBash keeps remote stdout out of its return stream", () => {
  const sshLine = source()
    .split(/\r?\n/)
    .find((line) => line.includes("& ssh"));
  assert.ok(sshLine, "ssh invocation missing");
  assert.match(sshLine.trimEnd(), /\|\s*Out-Host$/);
});

test("Invoke-MintBash returns the SSH exit code as a scalar int", () => {
  assert.ok(source().includes("return [int]$LASTEXITCODE"));
});

test("callers still compare the scalar exit code against 0", () => {
  const text = source();
  assert.ok(text.includes("if ($code -ne 0) {"));
  assert.ok(text.includes("if ($liveCode -ne 0) {"));
});

function createSshStub() {
  const dir = mkdtempSync(path.join(tmpdir(), "ashley-mint-stub-"));
  mkdirSync(dir, { recursive: true });
  const stub = [
    "@echo off",
    "echo CANDIDATE_SHA=fake00000000",
    "echo === Ashley Mint coherent activation ===",
    "echo CHECKOUT_SHA=fake00000000",
    "echo OK. Activated checkout fake00000000",
    "exit /b %ASHLEY_FAKE_SSH_EXIT%",
  ].join("\r\n") + "\r\n";
  writeFileSync(path.join(dir, "ssh.cmd"), stub);
  return dir;
}

function runWrapper(stubDir, sshExit) {
  const env = { ...process.env };
  delete env.PATH;
  env.Path = `${stubDir};${env.Path ?? ""}`;
  env.ASHLEY_FAKE_SSH_EXIT = String(sshExit);
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WRAPPER],
    { encoding: "utf8", env },
  );
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("success propagation: remote exit 0 reports success and streams output", { skip }, () => {
  const stubDir = createSshStub();
  try {
    const run = runWrapper(stubDir, 0);
    assert.equal(run.code, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, /Remote update finished\./);
    assert.doesNotMatch(run.stdout, /SSH\/remote update failed/);
    assert.match(run.stdout, /Activated checkout fake00000000/);
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("failure propagation: remote exit 7 propagates as scalar exit 7", { skip }, () => {
  const stubDir = createSshStub();
  try {
    const run = runWrapper(stubDir, 7);
    assert.equal(run.code, 7, `stderr: ${run.stderr}`);
    assert.ok(run.stdout.includes("SSH/remote update failed (exit 7)."), `stdout head: ${run.stdout.slice(0, 300)}`);
    assert.doesNotMatch(run.stdout, /Remote update finished\./);
    assert.match(run.stdout, /Activated checkout fake00000000/);
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
  }
});
