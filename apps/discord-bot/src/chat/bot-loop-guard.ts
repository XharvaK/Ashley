/**
 * Counts consecutive messages from other bots and webhooks in one channel. A
 * person's message resets the run. Past the limit their messages are not
 * admitted, so two bots cannot keep her replying to each other.
 */
export function createBotExchangeGuard(options: { limit: number }): {
  admit(channelId: string, authorIsBot: boolean): boolean;
} {
  const runs = new Map<string, number>();
  return {
    admit(channelId: string, authorIsBot: boolean): boolean {
      if (!authorIsBot) {
        runs.delete(channelId);
        return true;
      }
      const run = (runs.get(channelId) ?? 0) + 1;
      runs.set(channelId, run);
      return run <= options.limit;
    },
  };
}

/** After four bot or webhook messages in a row with no person between, she stops answering them. */
export const BOT_EXCHANGE_LIMIT = 4;
