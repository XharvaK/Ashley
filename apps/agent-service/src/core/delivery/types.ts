export type DeliveryTrigger = "reactive" | "proactive";

export type DeliveryLane = "reactive" | "proactive" | "operational_fulfillment";

export type DeliveryState =
  | "drafted"
  | "reserved"
  | "sending"
  | "committed"
  | "partially_delivered"
  | "aborted"
  | "cancelled"
  | "expired";

export type DeliveryFinalizationReason =
  | "all_bubbles_delivered"
  | "generation_error"
  | "empty_draft"
  | "send_failure"
  | "send_failure_after_partial"
  | "cancelled"
  | "cancelled_after_partial"
  | "first_bubble_deadline_expired"
  | "generation_lease_expired"
  | "delivery_lease_expired"
  | "delivery_lease_expired_after_partial";

export type DeliveryAuxKind = "progress" | "delivery_error";

export type DeliveryBubblePlan = {
  ordinal: number;
  text: string;
};

export type DeliveryReservationRow = {
  id: number;
  ownerId: string;
  channel: string;
  threadId: string;
  userMessageId: number | null;
  decisionId: number | null;
  trigger: DeliveryTrigger;
  deliveryLane: DeliveryLane;
  initiativeReservationId: number | null;
  state: DeliveryState;
  errorCategory: string | null;
  finalizationReason: string | null;
  draftText: string | null;
  firstBubbleDeadlineAt: string | null;
  firstSentAt: string | null;
  generationLeaseExpiresAt: string | null;
  deliveryLeaseExpiresAt: string | null;
  phaseLifecycle: import("./phase-lifecycle.js").PhaseLifecycleEnvelope | null;
  createdAt: string;
  finalizedAt: string | null;
};

export type DeliveryBubbleRow = {
  reservationId: number;
  ordinal: number;
  text: string;
  discordMessageId: string | null;
  sentAt: string | null;
};

export const DISCORD_CONTENT_LIMIT = 1990;

export function isTerminalDeliveryState(state: DeliveryState): boolean {
  switch (state) {
    case "committed":
    case "partially_delivered":
    case "aborted":
    case "cancelled":
    case "expired":
      return true;
    case "drafted":
    case "reserved":
    case "sending":
      return false;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function isSendableDeliveryState(state: DeliveryState): boolean {
  return state === "reserved" || state === "sending";
}
