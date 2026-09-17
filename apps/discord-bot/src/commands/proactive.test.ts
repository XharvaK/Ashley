import assert from "node:assert/strict";
import { test } from "node:test";
import type { InitiativeStatus } from "../agent-client.js";
import { renderProactiveStatus } from "./proactive.js";

test("proactive status renders periodic truth without legacy message aliases", () => {
  const status = {
    statusAvailability: "available",
    legacyProactiveEnabled: true,
    legacyPaused: false,
    legacySentToday: 0,
    legacyMaxPerDay: 10,
    legacyLastSentAt: null,
    legacyMinIdleHours: 2,
    periodicCognitionEnabled: true,
    periodicScheduleState: "waiting",
    periodicCadenceMs: 14_400_000,
    nextEligibleAt: "2026-09-18T12:00:00.000Z",
    pendingOccurrenceId: null,
    activeConversationId: "conversation-1",
    lastOwnerEvidenceAt: "2026-09-18T08:00:00.000Z",
    eligibleOccupiedConcernCount: 2,
    lastPeriodicOccurrence: {
      outcome: "skipped_empty",
      detail: "no-candidate",
      eligibleAt: "2026-09-18T04:00:00.000Z",
      closedAt: "2026-09-18T04:00:01.000Z",
    },
    lastProactiveThought: {
      cycleId: "cycle-1",
      generation: 1,
      conversationId: "conversation-1",
      triggerKind: "periodic",
      state: "settled",
      admittedAt: "2026-09-18T04:00:00.000Z",
    },
    lastProactiveDelivery: {
      outboxId: 4,
      cycleId: "cycle-1",
      generation: 1,
      status: "delivered",
      suppressed: false,
      nuclearReservationId: 8,
    },
  } satisfies InitiativeStatus;

  const rendered = renderProactiveStatus(status, {
    active: true,
    running: true,
    cadenceMinutes: 240,
  });

  assert.match(rendered, /Legacy proactive switch: on/);
  assert.match(rendered, /Periodic cognition: enabled/);
  assert.match(rendered, /Scheduler: active \(running\); poll: waiting/);
  assert.match(rendered, /Next opportunity: 2026-09-18T12:00:00.000Z/);
  assert.match(rendered, /Last opportunity: skipped_empty \(no-candidate\)/);
  assert.match(rendered, /Eligible occupied concerns: 2/);
  assert.match(rendered, /Last proactive Thought: settled/);
  assert.match(rendered, /Last proactive message: delivered/);
  assert.doesNotMatch(rendered, /Last thing you said|lastUserMessageAt|Unprompted messages/);
});
