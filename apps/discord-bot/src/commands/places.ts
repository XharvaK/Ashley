import type { ChatInputCommandInteraction } from "discord.js";
import { listPlaces, switchPlace } from "../agent-client.js";
import { fitLines } from "./fit-lines.js";

/** G1: Alex sees Ashley's places and closes or reopens one. Never a required step for her. */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand === "list") {
    const { places, web, rules } = await listPlaces();
    const lines = [
      ...places.map((place) => `\`${place.ref}\` ${place.name} (${place.kind})${place.closed ? ", closed by you" : ""}`
        + `${place.theyAsked?.length ? `, they asked: ${place.theyAsked.join(", ")}` : ""}`
        + `${place.postsLast24h ? `, ${place.postsLast24h} posts today` : ""}`),
      ...web.map((site) => `\`${site.origin}\` website, ${site.state}${site.reason ? `: ${site.reason}` : ""}`),
      ...(rules.length ? ["", "Her own rules:", ...rules.map((rule) => `\`${rule.place}\` ${rule.rule}`)] : []),
    ];
    await interaction.editReply(lines.length ? fitLines(lines) : "No places beyond your DM yet.");
    return;
  }
  const place = interaction.options.getString("place", true);
  const state = subcommand === "close" ? "closed" : "open";
  const result = await switchPlace(place, state);
  await interaction.editReply(state === "closed"
    ? `\`${result.place}\` is closed: nothing she posts there goes out until you open it.`
    : `\`${result.place}\` is open to her.`);
}
