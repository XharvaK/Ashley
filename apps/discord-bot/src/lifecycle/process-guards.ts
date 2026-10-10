import { EXIT_CODES } from "./exit-codes.js";

type GuardProcess = {
  on: (event: "unhandledRejection" | "uncaughtException", listener: (error: unknown) => void) => unknown;
  exit: (code: number) => void;
};

/**
 * A rejected promise nobody awaited (for example a slash reply after Discord's window) does not
 * stop the bot: it is logged and the bot keeps serving. An uncaught exception leaves process state
 * unknown, so it is logged and the process exits for the supervisor to restart it.
 */
export function installProcessGuards(
  proc: GuardProcess = process,
  log: Pick<Console, "error"> = console,
): void {
  proc.on("unhandledRejection", (reason) => {
    log.error("[discord-bot] unhandled promise rejection; the bot stays up", reason);
  });
  proc.on("uncaughtException", (error) => {
    log.error("[discord-bot] uncaught exception; exiting for restart", error);
    proc.exit(EXIT_CODES.TRANSIENT);
  });
}
