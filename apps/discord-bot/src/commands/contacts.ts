import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { entityName } from "../entity-names.js";
import { addContact, listContacts, removeContact, setContactTeacher, type TrustedContact } from "../agent-client.js";
import { pageLines } from "./fit-lines.js";

/** A3: Alex decides who may talk with Ashley. Contacts get no admin. */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand === "list") {
    const { contacts } = await listContacts();
    if (contacts.length === 0) {
      await interaction.editReply("No trusted contacts yet.");
      return;
    }
    // A long list goes out over several private messages; no line is lost to the Discord size limit.
    const pages = pageLines(contacts.map((contact) => `<@${contact.principalId}> (${contact.scope === "person_wide" ? "DMs and trusted rooms" : "DMs only"})`
      + `${contact.teacher ? ", one of her teachers" : ""}`));
    await interaction.editReply(pages[0]!);
    for (const page of pages.slice(1)) {
      await interaction.followUp({ content: page, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  const user = interaction.options.getUser("user", true);
  if (subcommand === "add") {
    const scope = (interaction.options.getString("scope") ?? "dm_only") as TrustedContact["scope"];
    await addContact(user.id, scope);
    await interaction.editReply(`<@${user.id}> can now talk with ${entityName()} (${scope === "person_wide" ? "DMs and trusted rooms" : "DMs only"}). Anything they tell her, you can read.`);
    return;
  }
  if (subcommand === "teacher") {
    const on = interaction.options.getBoolean("on", true);
    await setContactTeacher(user.id, on);
    await interaction.editReply(on ? `<@${user.id}> is now one of ${entityName()}'s teachers.` : `<@${user.id}> is no longer one of ${entityName()}'s teachers.`);
    return;
  }
  const { revoked } = await removeContact(user.id);
  await interaction.editReply(revoked > 0 ? `<@${user.id}> is no longer a trusted contact.` : `<@${user.id}> was not a trusted contact.`);
}
