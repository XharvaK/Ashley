import type { SendableChannels, Message } from "discord.js";
import { sendFailedLine } from "./fumble-lines.js";
import {
  PACE_BUDGET_MS,
  bubbleDelayMs,
  sleepAbortable,
} from "./pacing.js";

export type BubbleSendFailureCategory =
  | "discord_send_failed"
  | "aborted"
  | "deadline_expired"
  | "empty_plan";

export type BubbleSendResult = {
  reservationId: number | null;
  attemptedOrdinal: number | null;
  receiptedOrdinals: number[];
  failureCategory: BubbleSendFailureCategory | null;
  anySubstantiveContentVisible: boolean;
  messages: Message[];
};

export class DeliverySendError extends Error {
  readonly result: BubbleSendResult;

  constructor(message: string, result: BubbleSendResult) {
    super(message);
    this.name = "DeliverySendError";
    this.result = result;
  }
}

export type PlannedBubble = { ordinal: number; text: string };

/**
 * Send planned content bubbles one at a time. Every successful Discord send is
 * returned with its Message so the caller can receipt before continuing.
 * Failures throw DeliverySendError with structured partial progress.
 */
export async function sendBubbles(
  channel: SendableChannels,
  chunks: PlannedBubble[] | string[],
  gifUrl: string | null,
  pacing: { tempoGapMs: number | null; signal: AbortSignal } | null,
  onFirstSend?: () => void,
  options?: {
    reservationId?: number | null;
    skipFirstDelay?: boolean;
    firstBubbleDeadlineAtMs?: number;
    finalDeliveryDeadlineAtMs?: number;
    onBubbleSent?: (ordinal: number, message: Message) => Promise<void>;
    clock?: { nowMs(): number };
  },
): Promise<BubbleSendResult> {
  const nowMs = (): number => options?.clock?.nowMs() ?? Date.now();
  const planned: PlannedBubble[] = chunks.map((chunk, index) =>
    typeof chunk === "string"
      ? { ordinal: index, text: chunk }
      : chunk,
  );

  const result: BubbleSendResult = {
    reservationId: options?.reservationId ?? null,
    attemptedOrdinal: null,
    receiptedOrdinals: [],
    failureCategory: null,
    anySubstantiveContentVisible: false,
    messages: [],
  };

  if (planned.length === 0 && !gifUrl) {
    result.failureCategory = "empty_plan";
    throw new DeliverySendError("empty_send_plan", result);
  }

  let budget = PACE_BUDGET_MS;
  let firstSent = false;
  const markFirst = () => {
    if (firstSent) return;
    firstSent = true;
    onFirstSend?.();
  };

  for (let i = 0; i < planned.length; i++) {
    const bubble = planned[i]!;
    result.attemptedOrdinal = bubble.ordinal;
    if (pacing?.signal.aborted) {
      result.failureCategory = "aborted";
      throw new DeliverySendError("send_aborted", result);
    }
    if (
      !firstSent &&
      options?.firstBubbleDeadlineAtMs !== undefined &&
      nowMs() >= options.firstBubbleDeadlineAtMs
    ) {
      result.failureCategory = "deadline_expired";
      throw new DeliverySendError("first_bubble_deadline_expired", result);
    }
    if (
      options?.finalDeliveryDeadlineAtMs !== undefined &&
      nowMs() >= options.finalDeliveryDeadlineAtMs
    ) {
      result.failureCategory = "deadline_expired";
      throw new DeliverySendError("final_delivery_deadline_expired", result);
    }

    if (i > 0 && pacing && !pacing.signal.aborted) {
      const delay = bubbleDelayMs({
        tempoGapMs: pacing.tempoGapMs,
        chars: bubble.text.length,
        remainingBudgetMs: budget,
      });
      budget -= delay;
      await sleepAbortable(delay, pacing.signal);
    }

    const withGif = i === 0 && gifUrl;
    let msg: Message;
    try {
      msg = await channel.send(
        withGif
          ? {
              content: bubble.text,
              files: [{ attachment: gifUrl, name: "ashley.gif" }],
            }
          : bubble.text,
      );
    } catch (err) {
      console.warn(`[discord-bot] bubble ${bubble.ordinal} send failed:`, err);
      if (withGif) {
        try {
          msg = await channel.send(bubble.text);
        } catch (retryErr) {
          console.warn("[discord-bot] text-only retry failed:", retryErr);
          result.failureCategory = "discord_send_failed";
          throw new DeliverySendError("bubble_send_failed", result);
        }
      } else {
        result.failureCategory = "discord_send_failed";
        throw new DeliverySendError("bubble_send_failed", result);
      }
    }
    result.messages.push(msg);
    result.anySubstantiveContentVisible = true;
    markFirst();
    result.receiptedOrdinals.push(bubble.ordinal);
    await options?.onBubbleSent?.(bubble.ordinal, msg);
    if (
      options?.finalDeliveryDeadlineAtMs !== undefined &&
      nowMs() >= options.finalDeliveryDeadlineAtMs
    ) {
      result.failureCategory = "deadline_expired";
      throw new DeliverySendError("final_delivery_deadline_expired", result);
    }
  }

  if (planned.length === 0 && gifUrl) {
    try {
      const msg = await channel.send({
        files: [{ attachment: gifUrl, name: "ashley.gif" }],
      });
      result.messages.push(msg);
      markFirst();
    } catch (err) {
      console.warn("[discord-bot] gif-only send failed:", err);
      result.failureCategory = "discord_send_failed";
      throw new DeliverySendError("gif_only_send_failed", result);
    }
  }

  return result;
}

/** Ledgerable delivery-error notice — caller must receipt as auxiliary. */
export async function sendDeliveryErrorNotice(
  channel: SendableChannels,
): Promise<Message> {
  return channel.send(sendFailedLine());
}
