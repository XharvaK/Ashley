import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "./core/db.js";
import { openTestSidecar } from "./core/cognitive-v021/test-support.js";

const recovery = vi.hoisted(() => ({ reached: false }));
const systemNoticeRecovery = vi.hoisted(() => ({ options: undefined as unknown }));

vi.mock("./server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./server.js")>();
  return {
    ...actual,
    listen: vi.fn(() => {
      throw new Error("listen_must_not_run");
    }),
  };
});

vi.mock("./core/cognitive-v021/retry/startup-outcome-recovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/cognitive-v021/retry/startup-outcome-recovery.js")>();
  return {
    ...actual,
    reconcileStrandedOutcomeUnknownAtStartup: () => {
      recovery.reached = true;
      throw new Error("required_recovery_failed");
    },
  };
});

vi.mock("./core/cognitive-v021/sidecar/recovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/cognitive-v021/sidecar/recovery.js")>();
  return {
    ...actual,
    reconsiderPendingSpeechOutbox: vi.fn(async () => ({ reconsidered: 0, failures: 0 })),
    reconsiderPendingSystemNotices: vi.fn(async (_db, _project, options) => {
      systemNoticeRecovery.options = options;
      return { reconsidered: 0, failures: 0 };
    }),
  };
});

vi.mock("./core/cognitive-v021/retrieval/derived-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/cognitive-v021/retrieval/derived-store.js")>();
  return {
    ...actual,
    defaultDerivedIndexDbPath: () => join(tmpdir(), `ashley-boot-derived-${process.pid}.db`),
  };
});

vi.mock("./core/cognitive-v021/thought/diagnostics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/cognitive-v021/thought/diagnostics.js")>();
  return {
    ...actual,
    defaultObservabilityDbPath: () => join(tmpdir(), `ashley-boot-observability-${process.pid}.db`),
  };
});

vi.mock("./core/cognitive-v021/cycle/inbox-consumer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/cognitive-v021/cycle/inbox-consumer.js")>();
  return {
    ...actual,
    startInboxConsumer: () => {
      throw new Error("inbox_consumer_must_not_start");
    },
  };
});

import { serveAgent } from "./serve.js";
import * as server from "./server.js";

describe("P04 required recovery before listen", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    recovery.reached = false;
    systemNoticeRecovery.options = undefined;
    vi.mocked(server.listen).mockClear();
  });

  it("fails closed without becoming ready or listening when required recovery throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-boot-recovery-"));
    dirs.push(dir);
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    let state: "booting" | "ready" = "booting";
    const markStartupComplete = vi.fn(() => {
      state = "ready";
    });
    const manager = {
      init: async () => undefined,
      getState: () => state,
      openCognitiveSidecar: () => sidecar,
      configureCognitiveDispatch: vi.fn(),
      markStartupComplete,
      dataPlane: { kind: "isolated" },
      logger: { close: vi.fn() },
      shutdown: vi.fn(async () => undefined),
      core: {
        getDatabase: () => nuclear,
        getHealth: () => ({ dbPath: join(dir, "nuclear.db") }),
      },
    };

    await expect(serveAgent(manager as never)).rejects.toThrow("required_recovery_failed");

    expect(recovery.reached).toBe(true);
    expect(markStartupComplete).not.toHaveBeenCalled();
    expect(state).toBe("booting");
    expect(server.listen).not.toHaveBeenCalled();
    expect(systemNoticeRecovery.options).toBeUndefined();
  });
});
