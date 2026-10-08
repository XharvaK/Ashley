import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageFlags, type SendableChannels } from "discord.js";
import { sendBubbles } from "./send-bubbles.js";

function typingChannel(events: string[]): SendableChannels {
  return {
    sendTyping: async () => {
      events.push("typing");
    },
    send: async (payload: unknown) => {
      events.push(`send:${String(payload)}`);
      return { id: String(payload) } as never;
    },
  } as SendableChannels;
}

function mockChannel(sends: unknown[] = []): SendableChannels {
  return {
    send: async (payload: unknown) => {
      sends.push(payload);
      return {} as never;
    },
  } as SendableChannels;
}

describe("sendBubbles quiet", () => {
  it("sends a silent delivery with the suppress-notifications flag", async () => {
    const sends: unknown[] = [];
    const channel = mockChannel(sends);
    await sendBubbles(channel, ["quiet note"], null, null, undefined, { silent: true });
    assert.equal(MessageFlags.SuppressNotifications, 4096);
    assert.deepEqual(sends, [{ content: "quiet note", flags: 4096 }]);
  });
});

describe("sendBubbles onFirstSend", () => {
  it("receipts the first substantive bubble before sending the next bubble", async () => {
    const order: string[] = [];
    const channel = {
      send: async (payload: unknown) => {
        order.push(`send:${String(payload)}`);
        return { id: String(payload) } as never;
      },
    } as SendableChannels;

    await sendBubbles(channel, ["first", "second"], null, null, undefined, {
      onBubbleSent: async (ordinal) => {
        order.push(`receipt:${ordinal}`);
      },
    });

    assert.deepEqual(order, [
      "send:first",
      "receipt:0",
      "send:second",
      "receipt:1",
    ]);
  });

  it("treats receipt and final delivery as distinct hard boundaries", async () => {
    let nowMs = 1_000;
    const channel = {
      send: async () => {
        nowMs = 1_100;
        return { id: "first" } as never;
      },
    } as SendableChannels;

    await assert.rejects(
      sendBubbles(channel, ["first", "second"], null, null, undefined, {
        firstBubbleDeadlineAtMs: 1_050,
        finalDeliveryDeadlineAtMs: 1_080,
        clock: { nowMs: () => nowMs },
      }),
      /final_delivery_deadline_expired/,
    );
  });

  it("rechecks before every unsent bubble and halts the remainder", async () => {
    const order: string[] = [];
    const channel = {
      send: async (payload: unknown) => {
        order.push(`send:${String(payload)}`);
        return { id: String(payload) } as never;
      },
    } as SendableChannels;

    await assert.rejects(
      sendBubbles(channel, ["first", "second"], null, null, undefined, {
        beforeBubbleSend: async (ordinal) => {
          order.push(`recheck:${ordinal}`);
          if (ordinal === 1) throw new Error("external_publication_blocked:authority_vector_stale");
        },
        onBubbleSent: async (ordinal) => {
          order.push(`receipt:${ordinal}`);
        },
      }),
      /external_publication_blocked:authority_vector_stale/,
    );

    assert.deepEqual(order, [
      "recheck:0",
      "send:first",
      "receipt:0",
      "recheck:1",
    ]);
  });

  it("fires once after the first bubble, before later bubbles", async () => {
    const sends: unknown[] = [];
    const order: string[] = [];
    const channel = mockChannel(sends);

    await sendBubbles(channel, ["first", "second"], null, null, () => {
      order.push("firstSend");
    });

    assert.deepEqual(order, ["firstSend"]);
    assert.deepEqual(sends, ["first", "second"]);
  });

  it("fires for gif-only sends with no text chunks", async () => {
    let called = 0;
    const channel = mockChannel();
    await sendBubbles(channel, [], "https://example.com/a.gif", null, () => {
      called += 1;
    });
    assert.equal(called, 1);
  });
});

describe("sendBubbles typing", () => {
  it("does not type during the Thought wait, only after a draft is delivered", async () => {
    const events: Array<{ kind: string; at: number }> = [];
    const channel = {
      sendTyping: async () => {
        events.push({ kind: "typing", at: Date.now() });
      },
      send: async () => {
        events.push({ kind: "send", at: Date.now() });
        return { id: "m1" } as never;
      },
    } as SendableChannels;

    await new Promise((resolve) => setTimeout(resolve, 40));
    const thoughtFinishedAt = Date.now();
    assert.equal(events.length, 0);

    await sendBubbles(channel, ["hi"], null, null);

    const typings = events.filter((event) => event.kind === "typing");
    assert.ok(typings.length >= 1);
    assert.ok(typings[0]!.at >= thoughtFinishedAt);
    assert.ok(typings.every((event) => event.at >= thoughtFinishedAt));
  });

  it("types during the gap between bubbles", async () => {
    const events: string[] = [];
    const signal = new AbortController().signal;
    await sendBubbles(
      typingChannel(events),
      ["hello", "there"],
      null,
      { tempoGapMs: 1_000, signal },
    );
    const first = events.indexOf("send:hello");
    const second = events.indexOf("send:there");
    assert.ok(first > 0);
    assert.ok(second > first);
    assert.ok(events.slice(0, first).includes("typing"));
    assert.ok(events.slice(first + 1, second).includes("typing"));
  });

  it("sends no typing for a silent settlement", async () => {
    const events: string[] = [];
    const channel = typingChannel(events);
    const signal = new AbortController().signal;
    await assert.rejects(
      sendBubbles(channel, [], null, { tempoGapMs: null, signal }),
      /empty_send_plan/,
    );
    await sendBubbles(channel, [], "https://example.invalid/quiet.gif", {
      tempoGapMs: null,
      signal,
    });
    assert.equal(events.includes("typing"), false);
  });
});

describe("sendBubbles abort", () => {
  it("sends the rest of her burst at once when interrupted, never dropping it", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const result = await sendBubbles(
      typingChannel(events),
      ["one", "two", "three"],
      null,
      { tempoGapMs: 5_000, signal: controller.signal },
    );
    assert.deepEqual(events.filter((e) => e.startsWith("send:")), ["send:one", "send:two", "send:three"]);
    assert.equal(result.failureCategory, null);
  });
});
