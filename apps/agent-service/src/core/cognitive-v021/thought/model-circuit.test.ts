import { describe, expect, it } from "vitest";
import { THOUGHT_MODEL_CIRCUIT_MS, createThoughtModelCircuit } from "./model-circuit.js";

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

    circuit.noteFailure(MUSE, true, 1_000);
    expect(circuit.noteFailure(MUSE, false, 2_000)).toBe(false);
    expect(circuit.isOpen(MUSE, 1_000 + THOUGHT_MODEL_CIRCUIT_MS)).toBe(false);
  });

  it("is half-open after the window, closes on success, and re-opens on another qualifying failure", () => {
    const circuit = createThoughtModelCircuit();
    circuit.noteFailure(MUSE, true, 0);
    const halfOpenAt = THOUGHT_MODEL_CIRCUIT_MS;
    expect(circuit.isOpen(MUSE, halfOpenAt)).toBe(false);

    expect(circuit.noteFailure(MUSE, true, halfOpenAt)).toBe(true);
    expect(circuit.isOpen(MUSE, halfOpenAt)).toBe(true);
    expect(circuit.isOpen(MUSE, halfOpenAt + THOUGHT_MODEL_CIRCUIT_MS - 1)).toBe(true);
    const closedAt = halfOpenAt + THOUGHT_MODEL_CIRCUIT_MS;
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
});
