import type { ChatInputCommandInteraction } from "discord.js";
import type { InitiativeStatus } from "../agent-client.js";
import {
  getCognitiveIdleSchedulerStatus,
  getProactiveStatus,
  pauseProactive,
  resumeProactive,
} from "../initiative/scheduler.js";

type SchedulerStatus = ReturnType<typeof getCognitiveIdleSchedulerStatus>;

function at(value: string | null): string {
  return value ?? "unknown";
}

export function renderProactiveStatus(
  status: InitiativeStatus,
  scheduler: SchedulerStatus,
): string {
  const periodic = status.statusAvailability === "available"
    ? status.periodicCognitionEnabled ? "enabled" : "disabled"
    : "unavailable";
  const schedulerState = scheduler.active
    ? scheduler.running ? "active (running)" : "active"
    : "inactive";
  const occurrence = status.lastPeriodicOccurrence
    ? `${status.lastPeriodicOccurrence.outcome}${status.lastPeriodicOccurrence.detail ? ` (${status.lastPeriodicOccurrence.detail})` : ""} at ${status.lastPeriodicOccurrence.closedAt}`
    : "none";
  const thought = status.lastProactiveThought
    ? `${status.lastProactiveThought.state} at ${status.lastProactiveThought.admittedAt}`
    : "none";
  const delivery = status.lastProactiveDelivery
    ? `${status.lastProactiveDelivery.status} (outbox #${status.lastProactiveDelivery.outboxId})`
    : "none";
  return [
    `Legacy proactive switch: ${status.legacyProactiveEnabled ? "on" : "off"}`,
    `Periodic cognition: ${periodic}`,
    `Scheduler: ${schedulerState}; poll: ${status.periodicScheduleState}`,
    `Cadence: ~${scheduler.cadenceMinutes} minutes`,
    `Next opportunity: ${at(status.nextEligibleAt)}`,
    `Last opportunity: ${occurrence}`,
    `Eligible occupied concerns: ${status.statusAvailability === "available" ? status.eligibleOccupiedConcernCount : "unknown"}`,
    `Last proactive Thought: ${thought}`,
    `Last proactive message: ${delivery}`,
  ].join("\n");
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const action = interaction.options.getString("action", true);

  if (action === "status") {
    const status = await getProactiveStatus();
    await interaction.editReply(renderProactiveStatus(status, getCognitiveIdleSchedulerStatus()));
    return;
  }

  if (action === "pause") {
    await pauseProactive();
    await interaction.editReply({
      content: "Okay — I won't text first until you `/proactive resume`.",
    });
    return;
  }

  if (action === "resume") {
    await resumeProactive();
    await interaction.editReply({
      content: "Alright, I might text first again when there's a reason.",
    });
  }
}
