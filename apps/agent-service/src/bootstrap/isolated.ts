import { mkdirSync } from "node:fs";
import { AgentManager } from "../agent.js";
import { createIsolatedDataPlane } from "../core/data-plane.js";
import { loadEnvFile } from "../env.js";

export function isolatedDataDirFromArgv(argv: string[]): string {
  const dataDir = argv[2]?.trim() ?? "";
  if (!dataDir) {
    throw new Error("isolated_data_dir_required");
  }
  return dataDir;
}

export function bootstrapIsolatedRuntime(options: {
  dataDir: string;
}): AgentManager {
  const dataPlane = createIsolatedDataPlane(options.dataDir);
  mkdirSync(dataPlane.dataDir, { recursive: true });
  mkdirSync(dataPlane.conversationsDir, { recursive: true });
  loadEnvFile(dataPlane.envPath);
  return new AgentManager(dataPlane);
}
