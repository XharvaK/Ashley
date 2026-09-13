import { env } from "./env.js";

export function isAuthorizedOwnerId(
  userId: string | undefined,
  options: {
    configuredOwnerId?: string;
    personaEvalMode?: boolean;
  } = {},
): userId is string {
  if (!userId) return false;
  const configuredOwnerId = options.configuredOwnerId ?? env.discordOwnerId;
  const personaEvalMode = options.personaEvalMode ?? env.personaEvalMode;
  if (!configuredOwnerId) return true;
  if (userId === configuredOwnerId) return true;
  return personaEvalMode && userId.startsWith(`${configuredOwnerId}:persona-eval:`);
}
