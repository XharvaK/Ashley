import type { DeliveryFinalizationReason } from "./types.js";
import { finalizeDelivery, type FinalizeCause } from "./finalize.js";
import type { DatabaseSync } from "node:sqlite";

type AbortEntry = {
  controller: AbortController;
  ownerId: string;
};

const controllers = new Map<number, AbortEntry>();

export function registerDeliveryAbort(
  reservationId: number,
  ownerId: string,
): AbortSignal {
  abortDelivery(reservationId);
  const controller = new AbortController();
  controllers.set(reservationId, { controller, ownerId });
  return controller.signal;
}

export function getDeliveryAbortSignal(
  reservationId: number,
): AbortSignal | null {
  return controllers.get(reservationId)?.controller.signal ?? null;
}

export function clearDeliveryAbort(reservationId: number): void {
  controllers.delete(reservationId);
}

export function abortDelivery(reservationId: number): boolean {
  const entry = controllers.get(reservationId);
  if (!entry) return false;
  if (!entry.controller.signal.aborted) {
    entry.controller.abort();
  }
  return true;
}

/**
 * Request-scoped cancel: abort in-flight generation and finalize via the
 * centralized finalizer (partial if any content was already receipted).
 */
export function cancelDeliveryReservation(
  db: DatabaseSync,
  input: {
    reservationId: number;
    ownerId: string;
    onArchivalAssistant?: (text: string) => void;
  },
): {
  ok: boolean;
  state?: string;
  finalizationReason?: DeliveryFinalizationReason;
} {
  const entry = controllers.get(input.reservationId);
  if (entry && entry.ownerId !== input.ownerId) {
    return { ok: false };
  }
  abortDelivery(input.reservationId);
  try {
    const result = finalizeDelivery(db, {
      reservationId: input.reservationId,
      ownerId: input.ownerId,
      cause: "cancel" satisfies FinalizeCause,
      onArchivalAssistant: input.onArchivalAssistant,
    });
    clearDeliveryAbort(input.reservationId);
    return {
      ok: true,
      state: result.state,
      finalizationReason: result.finalizationReason,
    };
  } catch {
    clearDeliveryAbort(input.reservationId);
    return { ok: false };
  }
}
