import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execute, renderMemorySummary } from "./memory.js";

describe("memory command", () => {
  it("exports an execute handler", () => {
    assert.equal(typeof execute, "function");
  });

  it("renders empty stored memory as a mechanical Host listing", () => {
    const rendered = renderMemorySummary({ narrative: null, facts: [] });
    assert.equal(rendered, "Stored memory summary: no pinned memories.");
    assert.doesNotMatch(rendered, /tell me/i);
    assert.doesNotMatch(rendered, /I've got/i);
    assert.doesNotMatch(rendered, /Nothing pinned yet/);
  });

  it("renders pinned notes under the mechanical Host listing", () => {
    const rendered = renderMemorySummary({
      narrative: null,
      facts: [{ category: "note", value: "keep this" }],
    });
    assert.match(rendered, /^Stored memory summary:/);
    assert.match(rendered, /Standing notes:/);
    assert.doesNotMatch(rendered, /tell me/i);
  });

  it("lists Ashley's recent episodes as recent moments", () => {
    const rendered = renderMemorySummary({
      narrative: "Alex and I are planning a spring trip to Kyoto.",
      facts: [],
      episodes: [{ summary: "We picked cherry-blossom season.", endedAt: "2026-09-29T11:00:00.000Z" }],
    });
    assert.match(rendered, /Where we left off:\nAlex and I are planning a spring trip to Kyoto\./);
    assert.match(rendered, /Recent moments:\n• 2026-09-29: We picked cherry-blossom season\./);
  });

  it("lists Ashley's own time and her growing interests", () => {
    const rendered = renderMemorySummary({
      narrative: null,
      facts: [],
      activity: [
        { at: "2026-09-29T14:05:00.000Z", pass: "awake", activity: "read", entry: "Read about Basic Channel." },
        { at: "2026-09-29T11:00:00.000Z", pass: "afterglow", activity: null, entry: null },
      ],
      interests: [{ root: "Electronic music", branch: "dub techno" }],
    });
    assert.match(rendered, /Own time lately:\n• 2026-09-29 14:05 awake · read: Read about Basic Channel\.\n• 2026-09-29 11:00 afterglow\n/);
    assert.match(rendered, /Growing interests: dub techno \(Electronic music\)/);
  });

  it("shows her mood, the opinions she holds, and how she has changed", () => {
    const rendered = renderMemorySummary({
      narrative: null,
      facts: [],
      growth: {
        mood: { valence: 0.2, energy: 0.6, openness: 0.5, tension: 0.1, reason: "the Basic Channel thread lit me up" },
        opinions: [{ topic: "dub techno at night", stance: "best after 2am, on headphones" }],
        changes: [{ layer: "taste", text: "dub techno, essays that argue", appliedAt: "2026-10-02T03:00:00.000Z" }],
      },
    });
    assert.match(rendered, /Mood: valence \+0\.20, energy 0\.60, openness 0\.50, tension 0\.10 \(the Basic Channel thread lit me up\)/);
    assert.match(rendered, /Opinions she holds:\n• dub techno at night: best after 2am, on headphones/);
    assert.match(rendered, /How she has changed lately:\n• 2026-10-02 taste: dub techno, essays that argue/);
  });

  it("does not treat a resting mood alone as stored memory", () => {
    const rendered = renderMemorySummary({
      narrative: null,
      facts: [],
      growth: { mood: { valence: 0, energy: 0.5, openness: 0.5, tension: 0, reason: null }, opinions: [], changes: [] },
    });
    assert.equal(rendered, "Stored memory summary: no pinned memories.");
  });

  it("leads with who she is becoming and shows her diary", () => {
    const rendered = renderMemorySummary({
      narrative: null,
      facts: [],
      growth: {
        mood: { valence: 0, energy: 0.5, openness: 0.5, tension: 0, reason: null },
        opinions: [],
        changes: [],
        becoming: { text: "I am becoming someone who reads before she argues.", writtenAt: "2026-10-06T01:00:00.000Z" },
        diary: [{ day: "2026-10-05", text: "Quiet day; I read about Basic Channel." }],
      },
    });
    assert.match(rendered, /^Stored memory summary:\n\nWho she is becoming \(2026-10-06\):\nI am becoming someone who reads before she argues\./);
    assert.match(rendered, /Diary 2026-10-05: Quiet day; I read about Basic Channel\./);
  });

  it("shows the last night receipt after who she is becoming, at most three merges", () => {
    const rendered = renderMemorySummary({
      narrative: null,
      facts: [],
      growth: {
        mood: { valence: 0, energy: 0.5, openness: 0.5, tension: 0, reason: null },
        opinions: [],
        changes: [],
        dream: {
          cycleId: "night-1",
          at: "2026-10-06T01:00:00.000Z",
          sinceMs: 1,
          diary: true,
          narrative: true,
          rescored: 2,
          closed: ["q:one"],
          gapsStored: 0,
          merged: [
            { from: "m:a", to: "m:b", statement: "Lena gardens on Sundays." },
            { from: "m:c", to: "m:d", statement: "The kitchen faces the garden." },
            { from: "m:e", to: "m:f", statement: "Dub techno after two." },
            { from: "m:g", to: "m:h", statement: "A fourth merge stays off the page." },
          ],
        },
      },
    });
    assert.match(rendered, /Last night \(2026-10-06\): merged 4 · closed 1 · re-weighed 2 · wrote her diary · wrote who she is becoming\n• Lena gardens on Sundays\.\n• The kitchen faces the garden\.\n• Dub techno after two\.\n/);
    assert.doesNotMatch(rendered, /fourth merge/);
  });
});
