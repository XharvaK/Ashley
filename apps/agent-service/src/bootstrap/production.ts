import { mkdirSync } from "node:fs";
import { AgentManager } from "../agent.js";
import {
  createProductionDataPlane,
  type DataPlaneContext,
} from "../core/data-plane.js";
import { loadEnvFile } from "../env.js";

export function bootstrapProductionRuntime(options?: {
  dataDir?: string;
}): AgentManager {
  const dataPlane = createProductionDataPlane(options);
  return activateDataPlane(dataPlane);
}

function activateDataPlane(dataPlane: DataPlaneContext): AgentManager {
  mkdirSync(dataPlane.dataDir, { recursive: true });
  mkdirSync(dataPlane.conversationsDir, { recursive: true });
  loadEnvFile(dataPlane.envPath);
  return new AgentManager(dataPlane);
}
