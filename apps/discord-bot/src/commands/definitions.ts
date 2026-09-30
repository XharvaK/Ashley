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
      .setDescription("Show or control owner temporal work")
      .addIntegerOption((o) =>
        o.setName("offset").setDescription("Pagination offset").setMinValue(0),
      )
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("Optional exact control action")
          .addChoices(
            { name: "summary", value: "summary" },
            { name: "list", value: "list" },
            { name: "inspect", value: "inspect" },
            { name: "cancel", value: "cancel" },
            { name: "amend", value: "amend" },
            { name: "withdraw", value: "withdraw" },
          ),
      )
      .addStringOption((o) =>
        o
          .setName("kind")
          .setDescription("Exact stored work kind")
          .addChoices(
            { name: "future trigger", value: "future_trigger" },
            { name: "subscription", value: "subscription" },
            { name: "commitment", value: "commitment" },
            { name: "directive", value: "directive" },
          ),
      )
      .addStringOption((o) =>
        o.setName("id").setDescription("Exact stored id"),
      )
      .addStringOption((o) =>
        o.setName("due-at-ms").setDescription("New due/expiry Unix time in ms"),
      )
      .addStringOption((o) =>
        o.setName("purpose").setDescription("New stored purpose"),
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
    new SlashCommandBuilder()
      .setName(commandSurface.delegation)
      .setDescription("Manage bounded social operation delegations")
      .addSubcommand((subcommand) => subcommand
        .setName("grant")
        .setDescription("Grant bounded public operation classes in one conversation")
        .addStringOption((o) => o
          .setName("principal")
          .setDescription("Exact participant principal")
          .setRequired(true))
        .addStringOption((o) => o
          .setName("conversation")
          .setDescription("Exact conversation identifier")
          .setRequired(true))
        .addStringOption((o) => o
          .setName("classes")
          .setDescription("Comma-separated public_search, public_fetch, supplied_attachment, bounded_followup")
          .setRequired(true))
        .addStringOption((o) => o
          .setName("expires-at")
          .setDescription("Optional ISO expiry")
          .setRequired(false)))
      .addSubcommand((subcommand) => subcommand
        .setName("list")
        .setDescription("List current delegation records")
        .addStringOption((o) => o
          .setName("principal")
          .setDescription("Optional exact participant principal"))
        .addStringOption((o) => o
          .setName("conversation")
          .setDescription("Optional exact conversation identifier")))
      .addSubcommand((subcommand) => subcommand
        .setName("revoke")
        .setDescription("Revoke one exact delegation record")
        .addStringOption((o) => o
          .setName("id")
          .setDescription("Exact delegation entity UUID")
          .setRequired(true))
        .addIntegerOption((o) => o
          .setName("version")
          .setDescription("Expected current version")
          .setMinValue(1)))
      .toJSON(),
  ];
}
