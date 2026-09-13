import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MediaCadence } from "./media-cadence.js";

const ctx = (
  over: Partial<Parameters<MediaCadence["decide"]>[0]> = {},
): Parameters<MediaCadence["decide"]>[0] => ({
  channelId: "c1",
  wantReact: null,
  wantGif: false,
  rand: () => 0,
  ...over,
});

describe("MediaCadence", () => {
  it("allows a first gif", () => {
    const cadence = new MediaCadence();
    const r = cadence.decide(ctx({ wantGif: true }));
    assert.equal(r.gif, true);
    assert.equal(r.react, null);
  });

  it("allows a first react", () => {
    const cadence = new MediaCadence();
    const r = cadence.decide(ctx({ wantReact: "😂" }));
    assert.equal(r.react, "😂");
    assert.equal(r.gif, false);
  });

  it("never fires both a gif and a react in the same turn", () => {
    const cadence = new MediaCadence();
    const r = cadence.decide(ctx({ wantReact: "😂", wantGif: true }));
    assert.equal(r.gif, true);
    assert.equal(r.react, null);
  });

  it("holds the shared budget after a gif", () => {
    const cadence = new MediaCadence();
    assert.deepEqual(
      cadence.decide(ctx({ wantGif: true })),
      { react: null, gif: true, current: "gif" },
    );
    // MIN_TURNS_BETWEEN = 1, rand() = 0 → required = 1. Turn 2 is blocked.
    assert.deepEqual(
      cadence.decide(ctx({ wantReact: "🔥" })),
      { react: null, gif: false, current: "gif" },
    );
  });

  it("tracks channels independently", () => {
    const cadence = new MediaCadence();
    assert.equal(cadence.decide(ctx({ wantGif: true })).gif, true);
    assert.equal(
      cadence.decide(ctx({ channelId: "c2", wantReact: "😂" })).react,
      "😂",
    );
  });
});