/**
 * discord.js emits shardReady on every identify, and the first identify fires it before clientReady.
 * Only an identify after the bot is up is a fresh session that needs history and presence recovery.
 */
export function createReidentifyGate(): { markReady(): void; isReidentify(): boolean } {
  let ready = false;
  return {
    markReady() {
      ready = true;
    },
    isReidentify() {
      return ready;
    },
  };
}
