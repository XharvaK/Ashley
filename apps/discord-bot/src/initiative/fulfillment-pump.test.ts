import assert from "node:assert/strict";
import { test } from "node:test";
import type { Client, DMChannel, Message, User } from "discord.js";
import {
  drainPendingCognitiveDeliveries,
  startFulfillmentPump,
  stopFulfillmentPump,
  type FulfillmentPumpDependencies,
} from "./fulfillment-pump.js";
import type { PendingDelivery } from "../agent-client.js";

function makeFakeClient(
  channel: Partial<DMChannel> & { id: string },
): Client {
  const user = {
    id: "doc",
    createDM: async () => channel as DMChannel,
  } as unknown as User;

  return {
    users: {
      fetch: async () => user,
    },
  } as unknown as Client;
}

test("fulfillment pump drains, receipts and finalizes pending cognitive deliveries", async () => {
  const receipts: Array<{ reservationId: number; ordinal: number; messageId: string }> = [];
  const finalizations: Array<{ reservationId: number; cause: string }> = [];
  const sends: Array<{ text: string }> = [];

  const pending: PendingDelivery[] = [
    {
      reservationId: 101,
      draftText: "Job 1 complete",
      bubbles: [
        { ordinal: 0, text: "Job 1 complete", discordMessageId: null },
      ],
      statusUrl: "/delivery/101",
    },
    {
      reservationId: 102,
      draftText: "Job 2 complete",
      bubbles: [
        { ordinal: 0, text: "Job 2 complete", discordMessageId: null },
      ],
      statusUrl: "/delivery/102",
    },
  ];

  const fakeDeps: FulfillmentPumpDependencies = {
    claim: async () => ({ deliveries: pending }),
    receipt: async (reservationId, ordinal, discordMessageId) => {
      receipts.push({ reservationId, ordinal, messageId: discordMessageId });
      return { ok: true };
    },
    finalize: async (reservationId, cause) => {
      finalizations.push({ reservationId, cause });
      return { state: "committed", finalizationReason: "all_bubbles_delivered", deliveredText: "" };
    },
    send: async (_channel, chunks) => {
      const messages: Message[] = [];
      const ordinals: number[] = [];
      chunks.forEach((chunk, index) => {
        const text = typeof chunk === "string" ? chunk : chunk.text;
        sends.push({ text });
        const mid = `disc_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        messages.push({ id: mid } as Message);
        ordinals.push(index);
      });
      return {
        reservationId: null,
        attemptedOrdinal: null,
        receiptedOrdinals: ordinals,
        failureCategory: null,
        anySubstantiveContentVisible: true,
        messages,
      };
    },
  };

  const fakeClient = makeFakeClient({ id: "dm-cognitive-1" });
  const count = await drainPendingCognitiveDeliveries(fakeClient, fakeDeps);

  assert.equal(count, 2);
  assert.equal(sends.length, 2);
  assert.equal(receipts.length, 2);
  assert.equal(finalizations.length, 2);
  assert.equal(finalizations[0].cause, "complete");
  assert.equal(finalizations[1].cause, "complete");
});

test("fulfillment pump uses the same receipt/finalize flow for cognitive deliveries", async () => {
  const events: string[] = [];
  const pending: PendingDelivery[] = [{
    reservationId: 151,
    draftText: "cognitive draft",
    bubbles: [{ ordinal: 0, text: "cognitive draft", discordMessageId: null }],
    statusUrl: "/delivery/151",
  }];
  const deps: FulfillmentPumpDependencies = {
    claim: async () => ({ deliveries: pending }),
    receipt: async () => {
      events.push("receipt");
      return { ok: true };
    },
    finalize: async (_reservationId, cause) => {
      events.push(`finalize:${cause}`);
      return {
        state: "committed",
        finalizationReason: "all_bubbles_delivered",
        deliveredText: "cognitive draft",
      };
    },
    send: async () => ({
      reservationId: null,
      attemptedOrdinal: null,
      receiptedOrdinals: [0],
      failureCategory: null,
      anySubstantiveContentVisible: true,
      messages: [{ id: "cognitive-msg" } as Message],
    }),
  };

  const count = await drainPendingCognitiveDeliveries(
    makeFakeClient({ id: "dm-cognitive" }),
    deps,
  );
  assert.equal(count, 1);
  assert.deepEqual(events, ["receipt", "finalize:complete"]);
});

test("fulfillment pump records send_failure when Discord send has no visible content", async () => {
  const finalizations: Array<{ reservationId: number; cause: string }> = [];

  const pending: PendingDelivery[] = [
    {
      reservationId: 201,
      draftText: "Job failed send",
      bubbles: [{ ordinal: 0, text: "Job failed send", discordMessageId: null }],
      statusUrl: "/delivery/201",
    },
  ];

  const fakeDeps: FulfillmentPumpDependencies = {
    claim: async () => ({ deliveries: pending }),
    receipt: async () => ({ ok: true }),
    finalize: async (reservationId, cause) => {
      finalizations.push({ reservationId, cause });
      return { state: "aborted", finalizationReason: "send_failure", deliveredText: "" };
    },
    send: async () => {
      return {
        reservationId: null,
        attemptedOrdinal: null,
        receiptedOrdinals: [],
        failureCategory: "discord_send_failed",
        anySubstantiveContentVisible: false,
        messages: [],
      };
    },
  };

  const fakeClient = makeFakeClient({ id: "dm-cognitive-1" });
  const count = await drainPendingCognitiveDeliveries(fakeClient, fakeDeps);

  assert.equal(count, 0);
  assert.equal(finalizations.length, 1);
  assert.equal(finalizations[0].cause, "send_failure");
});

test("fulfillment pump never throws or halts on single item error", async () => {
  const finalizations: Array<{ reservationId: number; cause: string }> = [];

  const pending: PendingDelivery[] = [
    {
      reservationId: 301,
      draftText: "Job will throw on send",
      bubbles: [{ ordinal: 0, text: "Job will throw on send", discordMessageId: null }],
      statusUrl: "/delivery/301",
    },
    {
      reservationId: 302,
      draftText: "Job will succeed after",
      bubbles: [{ ordinal: 0, text: "Job will succeed after", discordMessageId: null }],
      statusUrl: "/delivery/302",
    },
  ];

  let first = true;
  const fakeDeps: FulfillmentPumpDependencies = {
    claim: async () => ({ deliveries: pending }),
    receipt: async () => ({ ok: true }),
    finalize: async (reservationId, cause) => {
      finalizations.push({ reservationId, cause });
      return { state: "committed", finalizationReason: cause, deliveredText: "" };
    },
    send: async () => {
      if (first) {
        first = false;
        throw new Error("transport network error");
      }
      return {
        reservationId: null,
        attemptedOrdinal: null,
        receiptedOrdinals: [0],
        failureCategory: null,
        anySubstantiveContentVisible: true,
        messages: [{ id: "msg_ok_1" } as Message],
      };
    },
  };

  const fakeClient = makeFakeClient({ id: "dm-cognitive-1" });
  const count = await drainPendingCognitiveDeliveries(fakeClient, fakeDeps);

  assert.equal(count, 1);
  assert.equal(finalizations.length, 2);
  // generic network error after dispatchStarted => UNKNOWN (delivery_lease), not proven send_failure
  assert.equal(finalizations[0].cause, "delivery_lease");
  assert.equal(finalizations[1].cause, "complete");
});

test("fulfillment pump returns zero when no cognitive deliveries are pending", async () => {
  const fakeDeps: FulfillmentPumpDependencies = {
    claim: async () => ({ deliveries: [] }),
    receipt: async () => ({ ok: true }),
    finalize: async () => ({ state: "committed", finalizationReason: "all_bubbles_delivered", deliveredText: "" }),
    send: async () => ({
      reservationId: null,
      attemptedOrdinal: null,
      receiptedOrdinals: [],
      failureCategory: null,
      anySubstantiveContentVisible: false,
      messages: [],
    }),
  };

  const fakeClient = makeFakeClient({ id: "dm-cognitive-1" });
  const count = await drainPendingCognitiveDeliveries(fakeClient, fakeDeps);
  assert.equal(count, 0);
});

test("fulfillment pump double-drain protection: send function called exactly once during in-flight delivery", async () => {
  let sendCount = 0;
  let sendEntered: (() => void) | null = null;
  const sendEnteredPromise = new Promise<void>((r) => { sendEntered = r; });
  let resolveSend: (() => void) | null = null;
  const sendReleasePromise = new Promise<void>((r) => { resolveSend = r; });

  const pending: PendingDelivery[] = [
    {
      reservationId: 401,
      draftText: "Concurrent claim test",
      bubbles: [{ ordinal: 0, text: "Concurrent claim test", discordMessageId: null }],
      statusUrl: "/delivery/401",
    },
  ];

  let claimedCount = 0;
  const fakeDeps: FulfillmentPumpDependencies = {
    claim: async () => {
      claimedCount += 1;
      // First call claims the item, subsequent call returns empty (atomic claim behavior)
      if (claimedCount === 1) {
        return { deliveries: pending };
      }
      return { deliveries: [] };
    },
    receipt: async () => ({ ok: true }),
    finalize: async () => ({ state: "committed", finalizationReason: "all_bubbles_delivered", deliveredText: "" }),
    send: async () => {
      sendCount += 1;
      sendEntered?.();
      // Hold in-flight
      await sendReleasePromise;
      return {
        reservationId: null,
        attemptedOrdinal: null,
        receiptedOrdinals: [0],
        failureCategory: null,
        anySubstantiveContentVisible: true,
        messages: [{ id: "msg_held_1" } as Message],
      };
    },
  };

  const fakeClient = makeFakeClient({ id: "dm-cognitive-double" });

  // Start drain 1
  const drain1Promise = drainPendingCognitiveDeliveries(fakeClient, fakeDeps);

  // Wait until send is in-flight
  await sendEnteredPromise;
  assert.equal(sendCount, 1);

  // Attempt drain 2 concurrently while send 1 is in-flight
  const drain2Promise = drainPendingCognitiveDeliveries(fakeClient, fakeDeps);

  // Release held send
  resolveSend?.();
  const [drained1, drained2] = await Promise.all([drain1Promise, drain2Promise]);

  assert.equal(drained1, 1);
  assert.equal(drained2, 0);
  assert.equal(sendCount, 1);
});

test("fulfillment pump completion-relative pacing: does not overlap ticks", async () => {
  stopFulfillmentPump();
  let claimCalls = 0;

  const fakeDeps: FulfillmentPumpDependencies = {
    claim: async () => {
      claimCalls += 1;
      return { deliveries: [] };
    },
    receipt: async () => ({ ok: true }),
    finalize: async () => ({ state: "committed", finalizationReason: "all_bubbles_delivered", deliveredText: "" }),
    send: async () => ({
      reservationId: null,
      attemptedOrdinal: null,
      receiptedOrdinals: [],
      failureCategory: null,
      anySubstantiveContentVisible: false,
      messages: [],
    }),
  };

  const fakeClient = makeFakeClient({ id: "dm-pacing" });
  startFulfillmentPump(fakeClient, 20, fakeDeps);

  // Immediate tick runs the current cognitive delivery lane at t=0.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(claimCalls, 1);

  // Wait 50ms (exceeds the 20ms interval)
  await new Promise((r) => setTimeout(r, 55));
  stopFulfillmentPump();

  // Next ticks fired sequentially without storming.
  assert.ok(claimCalls >= 2 && claimCalls <= 4);
});

test("generic Discord rejection after dispatch is UNKNOWN (delivery_lease), not proven not_sent", async () => {
  const finalizations: Array<{ cause: string }> = [];
  const pending: PendingDelivery[] = [
    { reservationId: 501, draftText: "unknown", bubbles: [{ ordinal: 0, text: "unknown", discordMessageId: null }], statusUrl: "/delivery/501" },
  ];
  const { DeliverySendError } = await import("../chat/send-bubbles.js");
  const fakeDeps: FulfillmentPumpDependencies = {
    claim: async () => ({ deliveries: pending }),
    receipt: async () => ({ ok: true }),
    finalize: async (_id, cause) => { finalizations.push({ cause }); return { state: "expired", finalizationReason: "delivery_lease_expired", deliveredText: "" }; },
    send: async (_ch, _chunks, _gif, _pacing, _onFirst, opts) => {
      const result = { reservationId: opts?.reservationId ?? null, attemptedOrdinal: 0, receiptedOrdinals: [] as number[], failureCategory: "discord_send_failed" as const, anySubstantiveContentVisible: false, messages: [] as Message[] };
      throw new DeliverySendError("bubble_send_failed", result);
    },
  };
  const client = makeFakeClient({ id: "dm-unknown" });
  await drainPendingCognitiveDeliveries(client, fakeDeps);
  assert.equal(finalizations[0].cause, "delivery_lease");
});

test("proven pre-dispatch failure (aborted before send) is safe send_failure", async () => {
  const finalizations: Array<{ cause: string }> = [];
  const pending: PendingDelivery[] = [
    { reservationId: 502, draftText: "pre", bubbles: [{ ordinal: 0, text: "pre", discordMessageId: null }], statusUrl: "/delivery/502" },
  ];
  const { DeliverySendError } = await import("../chat/send-bubbles.js");
  const fakeDeps: FulfillmentPumpDependencies = {
    claim: async () => ({ deliveries: pending }),
    receipt: async () => ({ ok: true }),
    finalize: async (_id, cause) => { finalizations.push({ cause }); return { state: "aborted", finalizationReason: "send_failure", deliveredText: "" }; },
    send: async () => {
      const result = { reservationId: null, attemptedOrdinal: null, receiptedOrdinals: [] as number[], failureCategory: "aborted" as const, anySubstantiveContentVisible: false, messages: [] as Message[] };
      throw new DeliverySendError("send_aborted", result);
    },
  };
  const client = makeFakeClient({ id: "dm-pre" });
  await drainPendingCognitiveDeliveries(client, fakeDeps);
  assert.equal(finalizations[0].cause, "send_failure");
});

test("partial success persists first bubble incrementally and finalizes partially_delivered", async () => {
  const receipts: Array<{ ordinal: number }> = [];
  const finalizations: Array<{ cause: string }> = [];
  const pending: PendingDelivery[] = [
    { reservationId: 503, draftText: "A".repeat(2500), bubbles: [{ ordinal: 0, text: "A".repeat(1800) }, { ordinal: 1, text: "B" }], statusUrl: "/delivery/503" },
  ];
  const { DeliverySendError } = await import("../chat/send-bubbles.js");
  const fakeDeps: FulfillmentPumpDependencies = {
    claim: async () => ({ deliveries: pending }),
    receipt: async (_id, ordinal) => { receipts.push({ ordinal }); return { ok: true }; },
    finalize: async (_id, cause) => { finalizations.push({ cause }); return { state: "partially_delivered", finalizationReason: "send_failure_after_partial", deliveredText: "" }; },
    send: async (_ch, _chunks, _gif, _pacing, _onFirst, opts) => {
      const onSent = opts?.onBubbleSent as ((ordinal: number, msg: Message) => Promise<void>) | undefined;
      if (onSent) await onSent(0, { id: "msg_partial_0" } as Message);
      const result = { reservationId: opts?.reservationId ?? null, attemptedOrdinal: 1, receiptedOrdinals: [0] as number[], failureCategory: "discord_send_failed" as const, anySubstantiveContentVisible: true, messages: [{ id: "msg_partial_0" } as Message] };
      throw new DeliverySendError("bubble_send_failed", result);
    },
  };
  const client = makeFakeClient({ id: "dm-partial" });
  await drainPendingCognitiveDeliveries(client, fakeDeps);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].ordinal, 0);
  assert.equal(finalizations[0].cause, "send_failure");
});

