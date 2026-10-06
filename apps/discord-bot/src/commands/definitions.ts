import {
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { commandSurface } from "../command-surface.js";

export function buildCommandDefinitions(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [
    new SlashCommandBuilder().setName(commandSurface.attention).setDescription("Show attention timing sensitivity and calibration").toJSON(),
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
            { name: "practices", value: "practices" },
            { name: "dimensions", value: "dimensions" },
            { name: "seed dimension", value: "seed-dimension" },
            { name: "revert dimension", value: "revert-dimension" },
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
      .addStringOption((o) =>
        o.setName("name").setDescription("Exact dimension name to seed").setMaxLength(200),
      )
      .addStringOption((o) =>
        o.setName("question").setDescription("Exact weekly question to seed").setMaxLength(400),
      )
      .addStringOption((o) =>
        o.setName("dimension-id").setDescription("Dimension id to revert").setMaxLength(80),
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
    new SlashCommandBuilder()
      .setName(commandSurface.contacts)
      .setDescription("Who may talk with Ashley (trusted contacts)")
      .addSubcommand((subcommand) => subcommand
        .setName("add")
        .setDescription("Let a person talk with Ashley")
        .addUserOption((o) => o.setName("user").setDescription("The person").setRequired(true))
        .addStringOption((o) => o
          .setName("scope")
          .setDescription("Where they may talk with her")
          .addChoices(
            { name: "DMs only", value: "dm_only" },
            { name: "DMs and trusted rooms", value: "person_wide" },
          )))
      .addSubcommand((subcommand) => subcommand
        .setName("teacher")
        .setDescription("Make a trusted contact one of her teachers, or not")
        .addUserOption((o) => o.setName("user").setDescription("The person").setRequired(true))
        .addBooleanOption((o) => o.setName("on").setDescription("Teacher on or off").setRequired(true)))
      .addSubcommand((subcommand) => subcommand
        .setName("remove")
        .setDescription("Stop a person talking with Ashley")
        .addUserOption((o) => o.setName("user").setDescription("The person").setRequired(true)))
      .addSubcommand((subcommand) => subcommand
        .setName("list")
        .setDescription("List trusted contacts"))
      .toJSON(),
    new SlashCommandBuilder()
      .setName(commandSurface.places)
      .setDescription("Ashley's places: rooms, contacts, websites")
      .addSubcommand((subcommand) => subcommand
        .setName("list")
        .setDescription("List her places and her own rules"))
      .addSubcommand((subcommand) => subcommand
        .setName("close")
        .setDescription("Close a place: nothing she posts there goes out")
        .addStringOption((o) => o.setName("place").setDescription("room:..., contact:... or a website origin").setRequired(true)))
      .addSubcommand((subcommand) => subcommand
        .setName("open")
        .setDescription("Open a place again, or let her into a website")
        .addStringOption((o) => o.setName("place").setDescription("room:..., contact:... or a website origin").setRequired(true)))
      .toJSON(),
  ];
}
