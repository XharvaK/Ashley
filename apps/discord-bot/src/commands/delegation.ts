import type { ChatInputCommandInteraction } from "discord.js";
import {
  grantSocialOperationDelegations,
  listSocialOperationDelegations,
  revokeSocialOperationDelegation,
  type SocialOperationClass,
} from "../agent-client.js";

const CLASSES: readonly SocialOperationClass[] = [
  "public_search",
  "public_fetch",
  "supplied_attachment",
  "bounded_followup",
];

function parseClasses(value: string): SocialOperationClass[] {
  const classes = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (classes.length === 0 || classes.some((item) => !CLASSES.includes(item as SocialOperationClass))) {
    const error = new Error("classes must contain only the bounded delegation classes") as Error & { code?: string };
    error.code = "bad_request";
    throw error;
  }
  return classes as SocialOperationClass[];
}

function render(value: unknown): string {
  return JSON.stringify(value, null, 2).slice(0, 1900);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand === "grant") {
    const principalId = interaction.options.getString("principal", true);
    const conversationId = interaction.options.getString("conversation", true);
    const operationClasses = parseClasses(interaction.options.getString("classes", true));
    const expiresAt = interaction.options.getString("expires-at");
    const result = await grantSocialOperationDelegations({
      principalId,
      conversationId,
      operationClasses,
      ...(expiresAt === null ? {} : { expiresAt }),
    });
    await interaction.editReply(render(result));
    return;
  }
  if (subcommand === "list") {
    const principalId = interaction.options.getString("principal");
    const conversationId = interaction.options.getString("conversation");
    const result = await listSocialOperationDelegations({
      ...(principalId === null ? {} : { principalId }),
      ...(conversationId === null ? {} : { conversationId }),
    });
    await interaction.editReply(render(result));
    return;
  }
  const entityUuid = interaction.options.getString("id", true);
  const expectedVersion = interaction.options.getInteger("version");
  const result = await revokeSocialOperationDelegation({
    entityUuid,
    ...(expectedVersion === null ? {} : { expectedVersion }),
  });
  await interaction.editReply(render(result));
}
