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
      narrative: "Doc and I are planning a spring trip to Kyoto.",
      facts: [],
      episodes: [{ summary: "We picked cherry-blossom season.", endedAt: "2026-09-29T11:00:00.000Z" }],
    });
    assert.match(rendered, /Where we left off:\nDoc and I are planning a spring trip to Kyoto\./);
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
});
