import type { DatabaseSync } from "node:sqlite";
import type { CycleRecord, CycleTriggerKind, InboxEvent } from "../types.js";
import { getCycle } from "./inbox.js";

/** Derived host metadata. It is not persisted and never enters the model wire. */
export type SemanticCompositionProfile = "A" | "B" | "C";

export type OriginProfileResolution = Readonly<{
  profile: SemanticCompositionProfile;
  triggerKind: Exclude<CycleTriggerKind, "recovery">;
  originCycleId: string;
  originEventId: string | null;
  source: "current_cycle" | "event_kind" | "payload_cycle" | "predecessor_event";
}>;

type ProfileTriggerKind = Exclude<CycleTriggerKind, "recovery">;

function profileForTriggerKind(kind: CycleTriggerKind): SemanticCompositionProfile | null {
  switch (kind) {
    case "owner_message":
      return "A";
    case "observation_or_receipt":
      return "B";
    case "idle_opportunity":
    case "subscription_item":
    case "future_trigger_due":
      return "C";
    case "recovery":
      return null;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function triggerKindForEventKind(kind: string): ProfileTriggerKind | null {
  switch (kind) {
    case "observation_or_receipt":
      return "observation_or_receipt";
    case "idle_opportunity":
      return "idle_opportunity";
    case "subscription_item":
      return "subscription_item";
    case "future_trigger_due":
      return "future_trigger_due";
    case "owner_message":
    case "owner_utterance":
      return "owner_message";
    default:
      return null;
  }
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function cycleForPayload(db: DatabaseSync, payload: Record<string, unknown>): CycleRecord | null {
  const cycleId = text(payload.cycleId);
  return cycleId ? getCycle(db, cycleId) : null;
}

function predecessorCycle(
  db: DatabaseSync,
  event: InboxEvent,
  payload: Record<string, unknown>,
): { cycle: CycleRecord; eventId: string } | null {
  const repairOfEventId = text(payload.repairOfEventId)
    ?? text((db.prepare("SELECT repair_of_event_id FROM inbox_events WHERE id = ? LIMIT 1").get(event.id) as { repair_of_event_id?: unknown } | undefined)?.repair_of_event_id);
  if (!repairOfEventId) return null;
  const predecessor = db.prepare(
    "SELECT wake_id FROM inbox_events WHERE id = ? LIMIT 1",
  ).get(repairOfEventId) as { wake_id?: unknown } | undefined;
  const wakeId = text(predecessor?.wake_id);
  if (!wakeId) return null;
  const wake = db.prepare(
    "SELECT cycle_id FROM wakes WHERE wake_id = ? LIMIT 1",
  ).get(wakeId) as { cycle_id?: unknown } | undefined;
  const cycleId = text(wake?.cycle_id);
  const cycle = cycleId ? getCycle(db, cycleId) : null;
  return cycle ? { cycle, eventId: repairOfEventId } : null;
}

function fromCycle(
  cycle: CycleRecord | null,
  source: OriginProfileResolution["source"],
  originEventId: string | null,
): OriginProfileResolution | null {
  if (!cycle) return null;
  const profile = profileForTriggerKind(cycle.triggerKind);
  if (!profile || cycle.triggerKind === "recovery") return null;
  return {
    profile,
    triggerKind: cycle.triggerKind,
    originCycleId: cycle.cycleId,
    originEventId,
    source,
  };
}

/** Resolve A/B/C from existing trigger/cycle lineage. Recovery has no profile. */
export function resolveOriginProfile(
  db: DatabaseSync,
  event: InboxEvent,
  currentCycle: CycleRecord,
): OriginProfileResolution | null {
  const directKind = triggerKindForEventKind(event.kind);
  if (directKind) {
    const profile = profileForTriggerKind(directKind);
    if (!profile) return null;
    return {
      profile,
      triggerKind: directKind,
      originCycleId: currentCycle.cycleId,
      originEventId: event.id,
      source: "event_kind",
    };
  }

  if (event.kind !== "recovery" && event.kind !== "repair" && currentCycle.triggerKind !== "recovery") {
    return fromCycle(currentCycle, "current_cycle", event.id);
  }

  const payload = payloadRecord(event.payload);
  const fromPayload = fromCycle(cycleForPayload(db, payload), "payload_cycle", event.id);
  if (fromPayload) return fromPayload;

  const fromPredecessor = predecessorCycle(db, event, payload);
  if (fromPredecessor) {
    return fromCycle(fromPredecessor.cycle, "predecessor_event", fromPredecessor.eventId);
  }

  if (event.kind === "recovery" && currentCycle.triggerKind !== "recovery") {
    return fromCycle(currentCycle, "current_cycle", event.id);
  }
  return null;
}

export function profileForTrigger(triggerKind: CycleTriggerKind): SemanticCompositionProfile | null {
  return profileForTriggerKind(triggerKind);
}
