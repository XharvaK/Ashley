import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SendableChannels } from "discord.js";
import { sendBubbles } from "./send-bubbles.js";

function mockChannel(sends: unknown[] = []): SendableChannels {
  return {
    send: async (payload: unknown) => {
      sends.push(payload);
      return {} as never;
    },
  } as SendableChannels;
}

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
