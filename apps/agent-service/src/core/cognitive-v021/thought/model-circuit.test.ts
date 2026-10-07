import { describe, expect, it } from "vitest";
import { THOUGHT_MODEL_CIRCUIT_MAX_MS, THOUGHT_MODEL_CIRCUIT_MS, createThoughtModelCircuit } from "./model-circuit.js";

const MUSE = "meta/muse-spark-1.3-contributor";
const FLASH = "deepseek/deepseek-v4.1-flash";

describe("thought model circuit", () => {
  it("opens on a qualifying failure and skips while the window is open", () => {
    const circuit = createThoughtModelCircuit();
    expect(circuit.noteFailure(MUSE, true, 1_000)).toBe(true);
    expect(circuit.isOpen(MUSE, 1_000)).toBe(true);
    expect(circuit.isOpen(MUSE, 1_000 + THOUGHT_MODEL_CIRCUIT_MS - 1)).toBe(true);
  });

  it("does not open or extend on a non-qualifying failure", () => {
    const circuit = createThoughtModelCircuit();
    expect(circuit.noteFailure(MUSE, false, 1_000)).toBe(false);
    expect(circuit.isOpen(MUSE, 1_000)).toBe(false);
    expect(circuit.streak(MUSE)).toBe(0);
    expect(circuit.windowMs(MUSE)).toBe(0);

    circuit.noteFailure(MUSE, true, 1_000);
    expect(circuit.streak(MUSE)).toBe(1);
    expect(circuit.windowMs(MUSE)).toBe(THOUGHT_MODEL_CIRCUIT_MS);
    expect(circuit.noteFailure(MUSE, false, 2_000)).toBe(false);
    expect(circuit.streak(MUSE)).toBe(1);
    expect(circuit.windowMs(MUSE)).toBe(THOUGHT_MODEL_CIRCUIT_MS);
    expect(circuit.isOpen(MUSE, 1_000 + THOUGHT_MODEL_CIRCUIT_MS)).toBe(false);

    expect(circuit.noteFailure(MUSE, true, 1_000 + THOUGHT_MODEL_CIRCUIT_MS)).toBe(true);
    expect(circuit.streak(MUSE)).toBe(2);
    expect(circuit.windowMs(MUSE)).toBe(THOUGHT_MODEL_CIRCUIT_MS * 2);
  });

  it("is half-open after the window, closes on success, and re-opens on another qualifying failure", () => {
    const circuit = createThoughtModelCircuit();
    circuit.noteFailure(MUSE, true, 0);
    const halfOpenAt = THOUGHT_MODEL_CIRCUIT_MS;
    expect(circuit.isOpen(MUSE, halfOpenAt)).toBe(false);

    expect(circuit.noteFailure(MUSE, true, halfOpenAt)).toBe(true);
    expect(circuit.isOpen(MUSE, halfOpenAt)).toBe(true);
    const reopenedFor = THOUGHT_MODEL_CIRCUIT_MS * 2;
    expect(circuit.isOpen(MUSE, halfOpenAt + reopenedFor - 1)).toBe(true);
    const closedAt = halfOpenAt + reopenedFor;
    expect(circuit.isOpen(MUSE, closedAt)).toBe(false);
    expect(circuit.noteSuccess(MUSE, closedAt)).toBe(true);
    expect(circuit.isOpen(MUSE, closedAt)).toBe(false);
    expect(circuit.noteSuccess(MUSE, closedAt)).toBe(false);
  });

  it("keeps each model id independent", () => {
    const circuit = createThoughtModelCircuit();
    circuit.noteFailure(MUSE, true, 0);
    expect(circuit.isOpen(MUSE, 1)).toBe(true);
    expect(circuit.isOpen(FLASH, 1)).toBe(false);
    expect(circuit.noteSuccess(FLASH, 1)).toBe(false);
    expect(circuit.isOpen(MUSE, 1)).toBe(true);
  });

  it("widens consecutive qualifying failures from 10 to 60 minutes", () => {
    const circuit = createThoughtModelCircuit();
    const windows = [
      THOUGHT_MODEL_CIRCUIT_MS,
      THOUGHT_MODEL_CIRCUIT_MS * 2,
      THOUGHT_MODEL_CIRCUIT_MS * 4,
      THOUGHT_MODEL_CIRCUIT_MAX_MS,
      THOUGHT_MODEL_CIRCUIT_MAX_MS,
    ];
    let now = 0;
    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index]!;
      expect(circuit.noteFailure(MUSE, true, now)).toBe(true);
      expect(circuit.streak(MUSE)).toBe(index + 1);
      expect(circuit.windowMs(MUSE)).toBe(window);
      expect(circuit.isOpen(MUSE, now + window - 1)).toBe(true);
      expect(circuit.isOpen(MUSE, now + window)).toBe(false);
      now += window;
    }
  });

  it("resets to the base window when the half-open try succeeds", () => {
    const circuit = createThoughtModelCircuit();
    circuit.noteFailure(MUSE, true, 0);
    const secondAt = THOUGHT_MODEL_CIRCUIT_MS;
    circuit.noteFailure(MUSE, true, secondAt);
    expect(circuit.windowMs(MUSE)).toBe(THOUGHT_MODEL_CIRCUIT_MS * 2);
    const halfOpenAt = secondAt + THOUGHT_MODEL_CIRCUIT_MS * 2;
    expect(circuit.isOpen(MUSE, halfOpenAt)).toBe(false);
    expect(circuit.noteSuccess(MUSE, halfOpenAt)).toBe(true);
    expect(circuit.streak(MUSE)).toBe(0);
    expect(circuit.windowMs(MUSE)).toBe(0);
    expect(circuit.noteSuccess(MUSE, halfOpenAt)).toBe(false);
    expect(circuit.noteFailure(MUSE, true, halfOpenAt)).toBe(true);
    expect(circuit.streak(MUSE)).toBe(1);
    expect(circuit.windowMs(MUSE)).toBe(THOUGHT_MODEL_CIRCUIT_MS);
  });

  it("starts a quiet streak from the base window again", () => {
    const carried = createThoughtModelCircuit();
    carried.noteFailure(MUSE, true, 0);
    const endedAt = THOUGHT_MODEL_CIRCUIT_MS;
    const stillCarriedAt = endedAt + THOUGHT_MODEL_CIRCUIT_MAX_MS + THOUGHT_MODEL_CIRCUIT_MS;
    expect(carried.noteFailure(MUSE, true, stillCarriedAt)).toBe(true);
    expect(carried.streak(MUSE)).toBe(2);
    expect(carried.windowMs(MUSE)).toBe(THOUGHT_MODEL_CIRCUIT_MS * 2);

    const expired = createThoughtModelCircuit();
    expired.noteFailure(MUSE, true, 0);
    const expiredAt = stillCarriedAt + 1;
    expect(expired.noteFailure(MUSE, true, expiredAt)).toBe(true);
    expect(expired.streak(MUSE)).toBe(1);
    expect(expired.windowMs(MUSE)).toBe(THOUGHT_MODEL_CIRCUIT_MS);
    expect(expired.isOpen(MUSE, expiredAt + THOUGHT_MODEL_CIRCUIT_MS - 1)).toBe(true);
    expect(expired.isOpen(MUSE, expiredAt + THOUGHT_MODEL_CIRCUIT_MS)).toBe(false);
  });

  it("keeps streaks independent per model id", () => {
    const circuit = createThoughtModelCircuit();
    circuit.noteFailure(MUSE, true, 0);
    circuit.noteFailure(FLASH, true, 0);
    circuit.noteFailure(MUSE, true, THOUGHT_MODEL_CIRCUIT_MS);
    expect(circuit.streak(MUSE)).toBe(2);
    expect(circuit.windowMs(MUSE)).toBe(THOUGHT_MODEL_CIRCUIT_MS * 2);
    expect(circuit.isOpen(MUSE, THOUGHT_MODEL_CIRCUIT_MS)).toBe(true);
    expect(circuit.streak(FLASH)).toBe(1);
    expect(circuit.windowMs(FLASH)).toBe(THOUGHT_MODEL_CIRCUIT_MS);
    expect(circuit.isOpen(FLASH, THOUGHT_MODEL_CIRCUIT_MS)).toBe(false);
  });
});
