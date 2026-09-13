import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, connect as netConnect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCompleteSuccessResult, runSandboxM1 } from "../src/sandbox-m1.js";

const canRunReal = process.platform === "linux" && existsSync("/usr/bin/bwrap");

const SECRET_ENV_KEY = "ASHLEY_SANDBOX_M1_SECRET_SENTINEL";

function tryConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = netConnect({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 5000);
    timer.unref();
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(false);
    });
  });
}

describe.skipIf(!canRunReal)("sandbox-m1 file.roundtrip", () => {
  it(
    "crosses the real boundary: launcher -> bwrap -> node runner -> workspace",
    async () => {
      const sentinelDir = mkdtempSync(join(tmpdir(), "ashley-m1-sentinel-"));
      const sentinelPath = join(sentinelDir, "sentinel.txt");
      writeFileSync(sentinelPath, "sentinel", "utf8");
      const fd = openSync(sentinelPath, "r");
      const sentinelCanonical = realpathSync(sentinelPath);

      const previousSecret = process.env[SECRET_ENV_KEY];
      process.env[SECRET_ENV_KEY] = "s-" + randomBytes(16).toString("hex");

      let hits = 0;
      const server = createServer((sock) => {
        hits += 1;
        sock.destroy();
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const probePort = (server.address() as AddressInfo).port;

      try {
        const positiveControl = await tryConnect(probePort);
        expect(positiveControl).toBe(true);
        const baselineHits = hits;

        const result = await runSandboxM1(
          {
            version: 1,
            kind: "file.roundtrip",
            content: "hello",
            probePort,
            sentinelPath: sentinelCanonical,
            fdSentinelCanonical: sentinelCanonical,
          },
          {
            loopbackPositiveControlSucceeded: positiveControl,
            hostLoopbackSandboxHits: () => hits - baselineHits,
          },
        );

        expect(result.version).toBe(1);
        expect(result.kind).toBe("file.roundtrip");
        expect(isCompleteSuccessResult(result)).toBe(true);
        if (!result.ok) {
          throw new Error("sandbox run failed: " + result.code);
        }
        for (const key of Object.keys(result.checks)) {
          expect(result.checks[key as keyof typeof result.checks]).toBe(true);
        }

        expect(hits).toBe(baselineHits);
      } finally {
        closeSync(fd);
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(sentinelDir, { recursive: true, force: true });
        if (previousSecret === undefined) {
          delete process.env[SECRET_ENV_KEY];
        } else {
          process.env[SECRET_ENV_KEY] = previousSecret;
        }
      }

      expect(
        readdirSync(tmpdir()).filter((entry) => entry.startsWith("ashley-m1-")),
      ).toEqual([]);
    },
    90_000,
  );
});