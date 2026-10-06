import type { ChatInputCommandInteraction } from "discord.js";
import { addContact, listContacts, removeContact, type TrustedContact } from "../agent-client.js";

/** A3: Alex decides who may talk with Ashley. Contacts get no admin. */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand === "list") {
    const { contacts } = await listContacts();
    await interaction.editReply(contacts.length === 0
      ? "No trusted contacts yet."
      : contacts.map((contact) => `<@${contact.principalId}> (${contact.scope === "person_wide" ? "DMs and trusted rooms" : "DMs only"})`
        + `${contact.teaches ? `, teaches her ${contact.teaches}` : ""}`).join("\n"));
    return;
  }
  const user = interaction.options.getUser("user", true);
  if (subcommand === "add") {
    const scope = (interaction.options.getString("scope") ?? "dm_only") as TrustedContact["scope"];
    const teaches = interaction.options.getString("teaches")?.trim() || undefined;
    await addContact(user.id, scope, teaches);
    await interaction.editReply(`<@${user.id}> can now talk with Ashley (${scope === "person_wide" ? "DMs and trusted rooms" : "DMs only"})`
      + `${teaches ? ` and is one of her teachers (${teaches})` : ""}. Anything they tell her, you can read.`);
    return;
  }
  const { revoked } = await removeContact(user.id);
  await interaction.editReply(revoked > 0 ? `<@${user.id}> is no longer a trusted contact.` : `<@${user.id}> was not a trusted contact.`);
}
