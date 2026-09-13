import {
  bootstrapIsolatedRuntime,
  isolatedDataDirFromArgv,
} from "./bootstrap/isolated.js";
import { serveAgent } from "./serve.js";

const manager = bootstrapIsolatedRuntime({
  dataDir: isolatedDataDirFromArgv(process.argv),
});

serveAgent(manager).catch((err) => {
  console.error("[agent-service] fatal:", err);
  process.exit(1);
});
