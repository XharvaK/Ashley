import type { ChatInputCommandInteraction } from "discord.js";
import type { InitiativeStatus } from "../agent-client.js";
import {renderThalamusStatus} from "./thalamus-status.js";
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

/** Outcome and status names come from the Host as snake or kebab words; people read them as words. */
function plain(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

export function renderProactiveStatus(
  status: InitiativeStatus,
  scheduler: SchedulerStatus,
): string {
  const ownTime = status.statusAvailability === "available"
    ? status.periodicCognitionEnabled ? "enabled" : "disabled"
    : "unavailable";
  const schedulerState = scheduler.active
    ? scheduler.running ? "active (running)" : "active"
    : "inactive";
  const occurrence = status.lastPeriodicOccurrence
    ? `${plain(status.lastPeriodicOccurrence.outcome)}${status.lastPeriodicOccurrence.detail ? ` (${plain(status.lastPeriodicOccurrence.detail)})` : ""} at ${status.lastPeriodicOccurrence.closedAt}`
    : "none";
  const thought = status.lastProactiveThought
    ? `${plain(status.lastProactiveThought.state)} at ${status.lastProactiveThought.admittedAt}`
    : "none";
  const delivery = status.lastProactiveDelivery
    ? plain(status.lastProactiveDelivery.status)
    : "none";
  return [
    `Proactive messages: ${status.legacyProactiveEnabled ? "on" : "off"}`,
    `Thinking on her own: ${ownTime}`,
    `Scheduler: ${schedulerState}`,
    renderThalamusStatus(status.thalamus),
    `Cadence: about ${scheduler.cadenceMinutes} minutes`,
    `Next opportunity: ${at(status.nextEligibleAt)}`,
    `Last opportunity: ${occurrence}`,
    `Concerns she is occupied with: ${status.statusAvailability === "available" ? status.eligibleOccupiedConcernCount : "unknown"}`,
    `Last thought of her own: ${thought}`,
    `Last message she started: ${delivery}`,
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
      content: "Okay — I won't text first until you `/proactive resume`. Anything I had ready is held and goes out when you resume.",
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
