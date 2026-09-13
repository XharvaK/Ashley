import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { fieldDayWindow } from "./field-day.js";
import { assembleTranscript } from "./transcript.js";
import {
  createNuclearFixture,
  removeTemp,
  tempDir,
  writeJsonLines,
} from "../../../test/observer-support.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) removeTemp(path);
});

describe("owner-visible transcript reconstruction", () => {
  it("retains complete user/assistant JSONL, excludes system/tool, and joins only unique nuclear rows", () => {
    const dir = tempDir("observer-transcript-");
    temporaryPaths.push(dir);
    const sessionsRoot = `${dir}/sessions`;
    const nuclearPath = `${dir}/nuclear.db`;
    const db = createNuclearFixture(nuclearPath);
    db.prepare("INSERT INTO mem_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      11,
      "thread-1",
      "owner-1",
      "user",
      "hello Ashley",
      "discord",
      "2026-08-26T01:10:00.000Z",
      "never_public",
    );
    db.prepare("INSERT INTO mem_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      12,
      "thread-1",
      "owner-1",
      "assistant",
      "ambiguous",
      "discord",
      "2026-08-26T01:20:00.000Z",
      "never_public",
    );
    db.prepare("INSERT INTO mem_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      13,
      "thread-1",
      "owner-1",
      "assistant",
      "ambiguous",
      "discord",
      "2026-08-26T01:20:00.000Z",
      "never_public",
    );
    db.prepare("INSERT INTO mem_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      14,
      "thread-1",
      "owner-1",
      "assistant",
      "nuclear disagreement",
      "discord",
      "2026-08-26T01:30:00.000Z",
      "never_public",
    );
    db.close();

    writeJsonLines(sessionsRoot, "session-1", [
      { ts: "2026-08-26T01:00:00.000Z", role: "system", text: "system" },
      { ts: "2026-08-26T01:10:00.000Z", role: "user", text: "hello Ashley" },
      { ts: "2026-08-26T01:20:00.000Z", role: "assistant", text: "ambiguous" },
      {
        ts: "2026-08-26T01:25:00.000Z",
        role: "user",
        text: "private project note",
        data_classification: "private",
      },
      {
        ts: "2026-08-26T01:28:00.000Z",
        role: "tool",
        text: "tool payload",
      },
      {
        ts: "2026-08-26T01:30:00.000Z",
        role: "assistant",
        text: "jsonl disagreement",
        nuclear_message_id: 14,
      },
      {
        ts: "2026-08-26T01:40:00.000Z",
        role: "user",
        text: `credential ${"sk-" + "x".repeat(24)}`,
      },
      {
        ts: "2026-08-26T01:45:00.000Z",
        role: "user",
        text: "classified secret",
        data_classification: "secret",
      },
    ]);

    const nuclear = new DatabaseSync(nuclearPath, { readOnly: true });
    const result = assembleTranscript({
      sessionsRoot,
      window: fieldDayWindow("2026-08-26"),
      nuclear,
    });
    nuclear.close();

    expect(result.coverage).toBe("NORMAL");
    expect(result.transcript.sessions).toHaveLength(1);
    const messages = result.transcript.sessions[0]?.messages ?? [];
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(messages.some((message) => message.text_redacted === "tool payload")).toBe(false);
    expect(messages.find((message) => message.text_redacted === "hello Ashley")?.nuclear_message_id).toBe(11);
    expect(messages.find((message) => message.text_redacted === "ambiguous")?.nuclear_message_id).toBeNull();
    expect(messages.find((message) => message.text_redacted === "private project note")).toBeDefined();
    expect(messages.find((message) => message.text_redacted === "[credential omitted]")).toBeDefined();
    expect(messages.some((message) => message.text_redacted === "classified secret")).toBe(false);
    expect(result.gaps.some((gap) => gap.class === "SOURCE_CONFLICT")).toBe(true);
    expect(result.source_conflicts).toHaveLength(1);
    expect(result.source_conflicts[0]?.nuclear.text_redacted).toBe("nuclear disagreement");
  });

  it("marks a missing primary JSONL surface degraded without manufacturing rows", () => {
    const dir = tempDir("observer-transcript-missing-");
    temporaryPaths.push(dir);
    mkdirSync(`${dir}/empty`, { recursive: true });
    const result = assembleTranscript({
      sessionsRoot: `${dir}/missing-sessions`,
      window: fieldDayWindow("2026-08-26"),
      nuclear: null,
    });
    expect(result.coverage).toBe("DEGRADED_PARTIAL");
    expect(result.transcript.sessions).toEqual([]);
    expect(result.gaps).toContainEqual({
      class: "MISSING_JSONL",
      detail: "sessions_root_missing",
    });
  });

  it("canonicalizes shuffled session-directory enumeration", () => {
    const firstRoot = tempDir("observer-transcript-order-a-");
    const secondRoot = tempDir("observer-transcript-order-b-");
    temporaryPaths.push(firstRoot, secondRoot);
    const firstSessions = `${firstRoot}/sessions`;
    const secondSessions = `${secondRoot}/sessions`;
    writeJsonLines(firstSessions, "session-b", [
      { ts: "2026-08-26T01:02:00.000Z", role: "assistant", text: "b" },
    ]);
    writeJsonLines(firstSessions, "session-a", [
      { ts: "2026-08-26T01:01:00.000Z", role: "user", text: "a" },
    ]);
    writeJsonLines(secondSessions, "session-a", [
      { ts: "2026-08-26T01:01:00.000Z", role: "user", text: "a" },
    ]);
    writeJsonLines(secondSessions, "session-b", [
      { ts: "2026-08-26T01:02:00.000Z", role: "assistant", text: "b" },
    ]);
    const window = fieldDayWindow("2026-08-26");
    const first = assembleTranscript({ sessionsRoot: firstSessions, window, nuclear: null });
    const second = assembleTranscript({ sessionsRoot: secondSessions, window, nuclear: null });
    expect(JSON.stringify(first.transcript)).toBe(JSON.stringify(second.transcript));
  });
});
