import test from "node:test";
import assert from "node:assert/strict";
import { installProcessGuards } from "./process-guards.js";

type Listener = (error: unknown) => void;

function fakeProcess() {
  const listeners = new Map<string, Listener>();
  const exits: number[] = [];
  return {
    listeners,
    exits,
    proc: {
      on: (event: string, listener: Listener) => {
        listeners.set(event, listener);
      },
      exit: (code: number) => {
        exits.push(code);
      },
    },
  };
}

test("an unhandled rejection is logged and the bot stays up (A6-10)", () => {
  const { proc, listeners, exits } = fakeProcess();
  const logged: unknown[][] = [];
  installProcessGuards(proc as never, { error: (...args: unknown[]) => { logged.push(args); } });

  listeners.get("unhandledRejection")!(new Error("Unknown interaction"));

  assert.deepEqual(exits, []);
  assert.equal(logged.length, 1);
});

test("an uncaught exception is logged and exits for restart", () => {
  const { proc, listeners, exits } = fakeProcess();
  const logged: unknown[][] = [];
  installProcessGuards(proc as never, { error: (...args: unknown[]) => { logged.push(args); } });

  listeners.get("uncaughtException")!(new Error("boom"));

  assert.deepEqual(exits, [1]);
  assert.equal(logged.length, 1);
});
