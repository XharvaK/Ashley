import { validateConfig, config } from "./config.js";
import { startBot } from "./client.js";
import { channelQueue } from "./chat/channel-queue.js";
import { stopFulfillmentPump } from "./initiative/fulfillment-pump.js";
import { stopProactiveScheduler } from "./initiative/scheduler.js";
import { stopPresence } from "./presence.js";
import { checkGatewayBotAdmission, type GatewayAdmissionResult } from "./gateway/admission.js";
import { classifyDiscordStartupError } from "./lifecycle/classify.js";
import { EXIT_CODES } from "./lifecycle/exit-codes.js";
import type { Client } from "discord.js";

const DRAIN_MS = 3000;

export interface DiscordStartupDependencies {
  validateConfig?: () => void;
  checkAdmission?: (token: string) => Promise<GatewayAdmissionResult>;
  startBot?: () => Promise<Client>;
  setExitCode?: (code: number) => void;
  token?: string;
  registerSignalHandlers?: boolean;
}

export async function runDiscordMain(
  dependencies: DiscordStartupDependencies = {},
): Promise<number | undefined> {
  const validateConfigFn = dependencies.validateConfig ?? validateConfig;
  const checkAdmissionFn = dependencies.checkAdmission ?? checkGatewayBotAdmission;
  const startBotFn = dependencies.startBot ?? startBot;
  const setExitCodeFn = dependencies.setExitCode ?? ((code: number) => { process.exitCode = code; });
  const token = dependencies.token ?? config.token;
  const registerSignals = dependencies.registerSignalHandlers ?? true;

  try {
    validateConfigFn();
  } catch (err) {
    const classified = classifyDiscordStartupError(err);
    console.error(
      `[discord-bot] FATAL [${classified.code}] (exit ${classified.exitCode}): ${classified.message}`,
    );
    setExitCodeFn(classified.exitCode);
    return classified.exitCode;
  }

  const admission = await checkAdmissionFn(token);
  if (!admission.admitted) {
    if (admission.disposition === "INHIBITED_UNTIL") {
      console.error(
        `[discord-bot] INHIBITED [${admission.reason}] (exit ${admission.exitCode}): ${admission.remaining ?? 0}/${admission.total ?? 0} session starts remaining. Reset at ${admission.resetAtIso} (retryAtMs: ${admission.retryAtMs}, in ${Math.round(admission.resetAfterMs / 1000)}s). Login refused.`,
      );
      setExitCodeFn(admission.exitCode);
      return admission.exitCode;
    }
    if (admission.disposition === "OPERATOR_REQUIRED") {
      console.error(
        `[discord-bot] FATAL [${admission.code}] (exit ${admission.exitCode}): ${admission.message}. Check DISCORD_BOT_TOKEN.`,
      );
      setExitCodeFn(admission.exitCode);
      return admission.exitCode;
    }
    if (admission.disposition === "RETRYABLE") {
      console.warn(
        `[discord-bot] WARNING [${admission.reason}] (exit ${admission.exitCode}): ${admission.error}. Exiting for supervisor retry.`,
      );
      setExitCodeFn(admission.exitCode);
      return admission.exitCode;
    }
  }

  console.log(
    `[discord-bot] Gateway session allowance: ${admission.remaining}/${admission.total} remaining (resets in ${Math.round(admission.resetAfterMs / 1000)}s)`,
  );

  let client: Client;
  try {
    client = await startBotFn();
  } catch (err) {
    const classified = classifyDiscordStartupError(err);
    console.error(
      `[discord-bot] FATAL [${classified.code}] (exit ${classified.exitCode}): ${classified.message}`,
    );
    setExitCodeFn(classified.exitCode);
    return classified.exitCode;
  }

  if (registerSignals) {
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[discord-bot] ${signal}`);
      stopFulfillmentPump();
      stopProactiveScheduler();
      stopPresence();
      // Her reply is already committed to memory at this point. Aborting drops the
      // pacing delays so the remaining bubbles go out now, then we give delivery a
      // moment to finish before the socket dies.
      channelQueue.abortAll();
      await channelQueue.drain(DRAIN_MS);
      client.destroy();
      process.exit(EXIT_CODES.OK);
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js"))
) {
  void runDiscordMain();
}
