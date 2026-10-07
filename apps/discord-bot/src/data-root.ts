import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Mirrors agent-service reservedProductionDataDir. */
export function ashleyDataDir(): string {
  const configured = process.env.ASHLEY_DATA_DIR?.trim();
  return configured ? resolve(configured) : join(homedir(), ".composer-assistant");
}
