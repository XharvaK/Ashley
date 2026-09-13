import { describe, expect, it } from "vitest";
import { AppError } from "../../errors.js";
import {
  attachProviderHttpStatusBoundary,
  isDeadlineTimeoutError,
} from "./types.js";

function timeoutError(message = "The operation was aborted due to timeout"): Error {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

describe("isDeadlineTimeoutError", () => {
  it("accepts a TimeoutError when the dedicated deadline signal fired", async () => {
    const deadlineSignal = AbortSignal.timeout(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(deadlineSignal.aborted).toBe(true);
    expect(isDeadlineTimeoutError(timeoutError(), {
      deadlineSignal,
      deadlineAtMs: Date.now() + 60_000,
    })).toBe(true);
  });

  it("accepts a TimeoutError when the outer chain aborted with a timeout reason", async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(signal.aborted).toBe(true);
    expect(signal.reason?.name).toBe("TimeoutError");
    expect(isDeadlineTimeoutError(timeoutError(), {
      signal,
      deadlineAtMs: Date.now() + 60_000,
    })).toBe(true);
  });

  it("falls back to the exact absolute deadline fact when neither signal flag flipped", () => {
    expect(isDeadlineTimeoutError(timeoutError(), {
      deadlineAtMs: Date.now() - 1,
    })).toBe(true);
  });

  it("rejects a TimeoutError while the deadline remains", () => {
    expect(isDeadlineTimeoutError(timeoutError(), {
      deadlineAtMs: Date.now() + 60_000,
    })).toBe(false);
  });

  it("rejects a TimeoutError that arrived with a provider HTTP response", () => {
    const error = timeoutError();
    attachProviderHttpStatusBoundary(error, 503);
    expect(isDeadlineTimeoutError(error, {
      deadlineAtMs: Date.now() - 1,
    })).toBe(false);
  });

  it("never classifies by timeout prose alone", () => {
    expect(isDeadlineTimeoutError(new Error("upstream timeout"), {
      deadlineAtMs: Date.now() + 60_000,
    })).toBe(false);
    expect(isDeadlineTimeoutError(new TypeError("fetch failed"), {
      deadlineAtMs: Date.now() - 1,
    })).toBe(false);
  });

  it("rejects external AbortError cancellation even past the deadline", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    expect(isDeadlineTimeoutError(error, {
      deadlineAtMs: Date.now() - 1,
    })).toBe(false);
  });

  it("rejects non-errors", () => {
    expect(isDeadlineTimeoutError("TimeoutError", { deadlineAtMs: 0 })).toBe(false);
    expect(isDeadlineTimeoutError(null, { deadlineAtMs: 0 })).toBe(false);
  });
});

describe("timeout AppError code", () => {
  it("constructs a deadline AppError without inventing provider prose", () => {
    const error = new AppError("timeout", "Thought provider deadline exceeded", 408);
    expect(error.code).toBe("timeout");
    expect(error.httpStatus).toBe(408);
  });
});
