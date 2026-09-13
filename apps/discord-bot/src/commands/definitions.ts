import {
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { commandSurface } from "../command-surface.js";

export function buildCommandDefinitions(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [
    new SlashCommandBuilder()
      .setName(commandSurface.remember)
      .setDescription("Pin something to long-term memory")
      .addStringOption((o) =>
        o.setName("text").setDescription("What to remember").setRequired(true),
      )
      .addBooleanOption((o) =>
        o.setName("private").setDescription("Store privately"),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName(commandSurface.memory)
      .setDescription("Show what I remember")
      .addBooleanOption((o) =>
        o.setName("private").setDescription("Include private facts"),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName(commandSurface.newThread)
      .setDescription("Start a fresh conversation thread")
      .toJSON(),
    new SlashCommandBuilder()
      .setName(commandSurface.forget)
      .setDescription("Forget memories matching a topic")
      .addStringOption((o) =>
        o.setName("topic").setDescription("Topic to forget").setRequired(true),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName(commandSurface.proactive)
      .setDescription("Proactive outreach status and controls")
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("What to do")
          .setRequired(true)
          .addChoices(
            { name: "status", value: "status" },
            { name: "pause", value: "pause" },
            { name: "resume", value: "resume" },
          ),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName(commandSurface.identity)
      .setDescription("Review foundational identity proposals")
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("What to do")
          .setRequired(true)
          .addChoices(
            { name: "review", value: "review" },
            { name: "approve", value: "approve" },
            { name: "reject", value: "reject" },
            { name: "defer", value: "defer" },
          ),
      )
      .addIntegerOption((o) =>
        o
          .setName("review-id")
          .setDescription("Review ID (required for a decision)")
          .setMinValue(1),
      )
      .addStringOption((o) =>
        o
          .setName("rationale")
          .setDescription("Optional reason for the decision")
          .setMaxLength(1000),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName(commandSurface.commitments)
      .setDescription("Show active reminders and commitments")
      .addIntegerOption((o) =>
        o.setName("offset").setDescription("Pagination offset").setMinValue(0),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName(commandSurface.continuity)
      .setDescription("Show continuity sidecar snapshot")
      .toJSON(),
    new SlashCommandBuilder()
      .setName(commandSurface.status)
      .setDescription("Show delivery, attention, and capability health")
      .toJSON(),
  ];
}
