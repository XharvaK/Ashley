import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  reservedProductionContinuityDbPath,
  reservedProductionDataDir,
  reservedProductionNuclearDbPath,
} from "./core/data-plane.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Reserved production location identity — not an implicit open/migrate target. */
export const NUCLEAR_DB_PATH = reservedProductionNuclearDbPath();
export const CONTINUITY_DB_PATH = reservedProductionContinuityDbPath();
export const DATA_DIR = reservedProductionDataDir();
export const MIGRATION_BACKUPS_DIR = join(DATA_DIR, "migration-backups");

export const WORKSPACE_PATH =
  process.env.COMPOSER_WORKSPACE ?? join(__dirname, "..", "..", "..", "workspace");

export const REPO_CONFIG_PATH = join(__dirname, "..", "..", "..", "config");
