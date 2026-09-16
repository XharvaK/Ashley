import {
  type Client,
  type DMChannel,
  type SendableChannels,
} from "discord.js";
import { config, getRaEffectiveConfig } from "../config.js";
import { channelQueue } from "../chat/channel-queue.js";
import { splitMessage } from "../chat/split-message.js";
import {
  claimPendingCognitiveDeliveries,
  claimPendingSocialNotifications,
  checkHealth,
  finalizeDelivery,
  recheckExternalPublication,
  recheckOwnerDmPublication,
  recheckOwnerRoomPublication,
  receiptDeliveryBubble,
  type ExternalPublicationRecheckResult,
} from "../agent-client.js";
import { DeliverySendError, sendBubbles } from "../chat/send-bubbles.js";

type FulfillmentDelivery = Awaited<
  ReturnType<typeof claimPendingCognitiveDeliveries>
>["deliveries"][number];

export type FulfillmentPumpDependencies = {
  claim: () => Promise<{ deliveries: FulfillmentDelivery[] }>;
  claimSocial?: () => Promise<{ deliveries: FulfillmentDelivery[] }>;
  receipt: typeof receiptDeliveryBubble;
  finalize: typeof finalizeDelivery;
  send: typeof sendBubbles;
  health?: typeof checkHealth;
  recheck?: (reservationId: number) => Promise<ExternalPublicationRecheckResult>;
  recheckOwnerDm?: (reservationId: number) => Promise<ExternalPublicationRecheckResult>;
  recheckOwnerRoom?: (reservationId: number) => Promise<ExternalPublicationRecheckResult>;
};

export const FULFILLMENT_POLL_INTERVAL_MS = 1500;

// Local in-flight set as client defense-in-depth; server atomic claim is authoritative
const localInFlightReservations = new Set<number>();

type DeliveryTarget =
  | { kind: "owner" }
  | { kind: "external_dm"; principalId: string }
  | { kind: "room"; guildId: string; channelId: string }
  | { kind: "owner_room"; guildId: string; channelId: string }
  | { kind: "invalid" };

function deliveryTarget(destination: unknown): DeliveryTarget {
  if (destination === undefined) return { kind: "owner" };
  if (typeof destination !== "object" || destination === null) return { kind: "invalid" };
  const value = destination as {
    kind?: unknown;
    principalId?: unknown;
    guildId?: unknown;
    channelId?: unknown;
    ownerRoom?: unknown;
  };
  if (value.kind === "owner") return { kind: "owner" };
  if ((value.kind === "external_dm" || value.kind === "dm") &&
      typeof value.principalId === "string" && value.principalId.trim()) {
    return { kind: "external_dm", principalId: value.principalId.trim() };
  }
  if (value.kind === "room"
    && typeof value.guildId === "string" && value.guildId.trim()
    && typeof value.channelId === "string" && value.channelId.trim()) {
    return {
      kind: value.ownerRoom === true ? "owner_room" : "room",
      guildId: value.guildId.trim(),
      channelId: value.channelId.trim(),
    };
  }
  return { kind: "invalid" };
}

function externalDmPublicationEnabled(): boolean {
  return getRaEffectiveConfig().dmPublicationEnabled;
}

function roomPublicationEnabled(channelId: string): boolean {
  const raConfig = getRaEffectiveConfig();
  return raConfig.roomSeedActive
    && raConfig.roomPublicationChannelId === channelId;
}

function externalTarget(target: DeliveryTarget): target is Extract<DeliveryTarget, { kind: "external_dm" | "room" }> {
  return target.kind === "external_dm" || target.kind === "room";
}

function externalDispatchBlocked(
  reservationId: number,
  reason: string,
): DeliverySendError {
  return new DeliverySendError(`external_publication_blocked:${reason}`, {
    reservationId,
    attemptedOrdinal: null,
    receiptedOrdinals: [],
    failureCategory: "aborted",
    anySubstantiveContentVisible: false,
    messages: [],
  });
}

function ownerRoomDispatchBlocked(
  reservationId: number,
  reason: string,
): DeliverySendError {
  return new DeliverySendError(`owner_room_publication_blocked:${reason}`, {
    reservationId,
    attemptedOrdinal: null,
    receiptedOrdinals: [],
    failureCategory: "aborted",
    anySubstantiveContentVisible: false,
    messages: [],
  });
}

function ownerDmDispatchBlocked(
  reservationId: number,
  reason: string,
): DeliverySendError {
  return new DeliverySendError(`owner_dm_publication_blocked:${reason}`, {
    reservationId,
    attemptedOrdinal: null,
    receiptedOrdinals: [],
    failureCategory: "aborted",
    anySubstantiveContentVisible: false,
    messages: [],
  });
}

async function persistReceiptWithRetry(
  receipt: FulfillmentPumpDependencies["receipt"],
  reservationId: number,
  ordinal: number,
  discordMessageId: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await receipt(reservationId, ordinal, discordMessageId);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function drainPendingDeliveries(
  client: Client,
  deps: FulfillmentPumpDependencies,
): Promise<number> {
  const { deliveries } = await deps.claim();
  if (!deliveries || deliveries.length === 0) return 0;

  let ownerDm: DMChannel | null = null;
  let deliveredCount = 0;

  for (const delivery of deliveries) {
    if (localInFlightReservations.has(delivery.reservationId)) {
      continue;
    }
    localInFlightReservations.add(delivery.reservationId);

    try {
      const target = deliveryTarget(delivery.destination);
      if (target.kind === "invalid") {
        await deps.finalize(delivery.reservationId, "send_failure").catch(() => {});
        continue;
      }
      if (target.kind === "external_dm" && !externalDmPublicationEnabled()) {
        await deps.finalize(delivery.reservationId, "send_failure").catch(() => {});
        continue;
      }
      if ((target.kind === "room" || target.kind === "owner_room") && !roomPublicationEnabled(target.channelId)) {
        await deps.finalize(delivery.reservationId, "send_failure").catch(() => {});
        continue;
      }
      const channel: SendableChannels = target.kind === "room" || target.kind === "owner_room"
        ? await (async () => {
            const fetched = await client.channels.fetch(target.channelId);
            if (!fetched || typeof (fetched as { send?: unknown }).send !== "function") {
              throw new Error("room_channel_not_sendable");
            }
            return fetched as SendableChannels;
          })()
        : target.kind === "external_dm"
          ? await (await client.users.fetch(target.principalId)).createDM()
          : (ownerDm ??= await (await client.users.fetch(config.ownerId)).createDM());
      const queueId = target.kind === "room" || target.kind === "owner_room" ? target.channelId : channel.id;

      const bubbles =
        delivery.bubbles.length > 0
          ? delivery.bubbles
          : splitMessage(delivery.draftText).map((text, ordinal) => ({
              ordinal,
              text,
            }));

      if (bubbles.length === 0) {
        await deps.finalize(delivery.reservationId, "send_failure").catch(() => {});
        continue;
      }

      let dispatchStarted = false;
      let sendError: unknown = null;
      let sendResult: Awaited<ReturnType<typeof sendBubbles>> | null = null;

      try {
        await channelQueue.enqueueOrThrow(queueId, async ({ signal }) => {
          if (target.kind === "owner") {
            const verdict = deps.recheckOwnerDm
              ? await deps.recheckOwnerDm(delivery.reservationId)
              : { ok: false as const, reason: "owner_dm_recheck_unavailable" };
            if (!verdict.ok) {
              throw ownerDmDispatchBlocked(delivery.reservationId, verdict.reason);
            }
          } else if (target.kind === "owner_room") {
            const verdict = deps.recheckOwnerRoom
              ? await deps.recheckOwnerRoom(delivery.reservationId)
              : { ok: false as const, reason: "owner_room_recheck_unavailable" };
            if (!verdict.ok) {
              throw ownerRoomDispatchBlocked(delivery.reservationId, verdict.reason);
            }
          } else if (externalTarget(target)) {
            const verdict = deps.recheck
              ? await deps.recheck(delivery.reservationId)
              : { ok: false as const, reason: "external_recheck_unavailable" };
            if (!verdict.ok) {
              throw externalDispatchBlocked(delivery.reservationId, verdict.reason);
            }
          }
          dispatchStarted = true;
          sendResult = await deps.send(
            channel,
            bubbles,
            null,
            {
              tempoGapMs: null,
              signal,
            },
            undefined,
            {
              reservationId: delivery.reservationId,
              onBubbleSent: async (ordinal, msg) => {
                await persistReceiptWithRetry(deps.receipt, delivery.reservationId, ordinal, msg.id);
              },
              beforeBubbleSend: target.kind === "owner"
                ? async () => {
                    const verdict = deps.recheckOwnerDm
                      ? await deps.recheckOwnerDm(delivery.reservationId)
                      : { ok: false as const, reason: "owner_dm_recheck_unavailable" };
                    if (!verdict.ok) {
                      throw new Error(`owner_dm_publication_blocked:${verdict.reason}`);
                    }
                  }
                : target.kind === "owner_room"
                ? async () => {
                    const verdict = deps.recheckOwnerRoom
                      ? await deps.recheckOwnerRoom(delivery.reservationId)
                      : { ok: false as const, reason: "owner_room_recheck_unavailable" };
                    if (!verdict.ok) {
                      throw new Error(`owner_room_publication_blocked:${verdict.reason}`);
                    }
                  }
                : externalTarget(target)
                ? async () => {
                    const verdict = deps.recheck
                      ? await deps.recheck(delivery.reservationId)
                      : { ok: false as const, reason: "external_recheck_unavailable" };
                    if (!verdict.ok) {
                      throw new Error(`external_publication_blocked:${verdict.reason}`);
                    }
                  }
                : undefined,
            },
          );
        });
      } catch (err) {
        sendError = err;
      }

      if (sendError) {
        const maybeDeliveryErr = sendError as Partial<DeliverySendError> & { result?: import("../chat/send-bubbles.js").BubbleSendResult };
        if (maybeDeliveryErr && maybeDeliveryErr.result && typeof maybeDeliveryErr.result.receiptedOrdinals !== "undefined") {
          const r = maybeDeliveryErr.result as import("../chat/send-bubbles.js").BubbleSendResult;
          // Receipts for successful bubbles already persisted via onBubbleSent (or failed with retry exhausted -> generic path below but DeliverySendError path handles partial)
          if (r.receiptedOrdinals.length > 0) {
            // Partial: at least one bubble durably receipted
            await deps.finalize(delivery.reservationId, "send_failure").catch(() => {});
          } else {
            // Zero receipts after dispatch are ambiguous. Keep the nuclear
            // reservation sending; a later receipt or explicit cancellation
            // must resolve it. These categories prove no dispatch occurred.
            if (
              r.failureCategory === "aborted" ||
              r.failureCategory === "deadline_expired" ||
              r.failureCategory === "empty_plan"
            ) {
              await deps.finalize(delivery.reservationId, "send_failure").catch(() => {});
            } else if (!dispatchStarted && r.attemptedOrdinal === null) {
              // The send boundary was never crossed, so failure is proven.
              await deps.finalize(delivery.reservationId, "send_failure").catch(() => {});
            }
          }
        } else {
          // Generic error after dispatch is UNKNOWN. Leave the reservation
          // sending because no durable evidence proves no external dispatch.
          if (!dispatchStarted) {
            await deps.finalize(delivery.reservationId, "send_failure").catch(() => {});
          }
        }
        continue;
      }

      if (!sendResult || !(sendResult as import("../chat/send-bubbles.js").BubbleSendResult).anySubstantiveContentVisible) {
        await deps.finalize(delivery.reservationId, "send_failure").catch(() => {});
        continue;
      }

      // Success: receipts already persisted via onBubbleSent; handle mock paths that return result without callback
      const successResult = sendResult as import("../chat/send-bubbles.js").BubbleSendResult;
      const receipts = successResult.receiptedOrdinals
        .map((ordinal: number, i: number) => ({
          ordinal,
          discordMessageId: successResult.messages[i]?.id ?? "",
        }))
        .filter((r: { discordMessageId: string }) => r.discordMessageId);

      let receiptFailures = 0;
      let successfulReceipts = 0;
      for (const receipt of receipts) {
        try {
          await persistReceiptWithRetry(deps.receipt, delivery.reservationId, receipt.ordinal, receipt.discordMessageId);
          successfulReceipts += 1;
        } catch {
          receiptFailures += 1;
        }
      }

      if (receiptFailures > 0) {
        // A durable receipt proves partial delivery. With zero durable
        // receipts, the successful Discord send remains ambiguous.
        if (successfulReceipts > 0) {
          await deps.finalize(delivery.reservationId, "delivery_lease").catch(() => {});
        }
        continue;
      }

      if (successfulReceipts === 0 && receipts.length > 0) {
        // Zero durable receipts survived despite dispatch success -> UNKNOWN.
        // Keep the nuclear reservation sending until evidence resolves it.
        continue;
      }

      if (successfulReceipts === 0 && receipts.length === 0 && successResult.messages.length > 0) {
        // Messages returned but no ordinals mapped -> UNKNOWN.
        continue;
      }

      // N-3 guard: if we thought we succeeded but durability is zero, treat as UNKNOWN already handled above; now safe to complete
      await deps.finalize(delivery.reservationId, "complete").catch(() => {});
      deliveredCount += 1;
      console.log(
        `[discord-bot] cognitive fulfillment delivered reservation=${delivery.reservationId} bubbles=${successfulReceipts}/${bubbles.length}`,
      );
    } catch (error) {
      console.error(
        `[discord-bot] cognitive fulfillment failed reservation=${delivery.reservationId}:`,
        error,
      );
      try {
        await deps.finalize(delivery.reservationId, "delivery_lease");
      } catch {
        /* best effort */
      }
    } finally {
      localInFlightReservations.delete(delivery.reservationId);
    }
  }

  return deliveredCount;
}

export async function drainPendingCognitiveDeliveries(
  client: Client,
  deps: FulfillmentPumpDependencies = {
    claim: claimPendingCognitiveDeliveries,
    receipt: receiptDeliveryBubble,
    finalize: finalizeDelivery,
    send: sendBubbles,
    recheck: recheckExternalPublication,
    recheckOwnerDm: recheckOwnerDmPublication,
    recheckOwnerRoom: recheckOwnerRoomPublication,
  },
): Promise<number> {
  return drainPendingDeliveries(client, deps);
}

export async function drainPendingSocialNotifications(
  client: Client,
  deps: FulfillmentPumpDependencies = {
    claim: claimPendingSocialNotifications,
    receipt: receiptDeliveryBubble,
    finalize: finalizeDelivery,
    send: sendBubbles,
    recheck: recheckExternalPublication,
    recheckOwnerDm: recheckOwnerDmPublication,
    recheckOwnerRoom: recheckOwnerRoomPublication,
  },
): Promise<number> {
  return drainPendingDeliveries(client, deps);
}

let pumpTimer: NodeJS.Timeout | null = null;
let pumpRunning = false;
let pumpStopped = false;

export function startFulfillmentPump(
  client: Client,
  intervalMs = FULFILLMENT_POLL_INTERVAL_MS,
  deps?: FulfillmentPumpDependencies,
): void {
  if (pumpTimer != null || pumpRunning) return;
  pumpStopped = false;

  const scheduleNext = () => {
    if (pumpStopped) return;
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      void tick();
    }, intervalMs);
    if (typeof pumpTimer.unref === "function") {
      pumpTimer.unref();
    }
  };

  const tick = async () => {
    if (pumpStopped || pumpRunning) return;
    pumpRunning = true;
    try {
      const health = deps?.health ?? checkHealth;
      if (!(await health())) return;
      await drainPendingCognitiveDeliveries(client, deps);
      // The social notification lane is independently gated. Existing test
      // seams that inject only the cognitive claim function do not acquire a
      // second remote lane accidentally.
      if (getRaEffectiveConfig().socialCaptureEnabled && (deps === undefined || deps.claimSocial)) {
        await drainPendingSocialNotifications(
          client,
          deps === undefined
            ? undefined
            : { ...deps, claim: deps.claimSocial! },
        );
      }
    } catch (err) {
      console.error("[discord-bot] error in fulfillment pump poll:", err);
    } finally {
      pumpRunning = false;
      if (!pumpStopped) {
        scheduleNext();
      }
    }
  };

  // Immediate drain on startup / ready, followed by completion-relative pacing
  void tick();
}

export function stopFulfillmentPump(): void {
  pumpStopped = true;
  if (pumpTimer != null) {
    clearTimeout(pumpTimer);
    pumpTimer = null;
  }
  pumpRunning = false;
  localInFlightReservations.clear();
}
