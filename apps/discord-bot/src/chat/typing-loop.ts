import type { TextBasedChannel } from "discord.js";

export async function runTypingLoop(
  channel: TextBasedChannel,
  until: () => boolean,
): Promise<() => void> {
  let stopped = false;
  const send = () => {
    if (stopped || until()) return;
    if ("sendTyping" in channel) void channel.sendTyping().catch(() => {});
  };
  send();
  const id = setInterval(send, 3000);
  const check = setInterval(() => {
    if (until() || stopped) {
      clearInterval(id);
      clearInterval(check);
    }
  }, 500);
  return () => {
    stopped = true;
    clearInterval(id);
    clearInterval(check);
  };
}
