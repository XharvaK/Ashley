import { bootstrapProductionRuntime } from "./bootstrap/production.js";
import { classifyAgentStartupError } from "./lifecycle/classify.js";
import { serveAgent } from "./serve.js";

export interface AgentStartupOptions {
  dataDir?: string;
  setExitCode?: (code: number) => void;
}

export async function runAgentMain(
  options: AgentStartupOptions = {},
): Promise<number | undefined> {
  const setExitCodeFn =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });

  const dataDir = options.dataDir;

  try {
    const manager = bootstrapProductionRuntime(dataDir ? { dataDir } : undefined);
    await serveAgent(manager);
  } catch (err) {
    const classified = classifyAgentStartupError(err);
    console.error(
      `[agent-service] FATAL [${classified.code}] (exit ${classified.exitCode}): ${classified.message}`,
    );
    if (classified.kind === "RETRYABLE" && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    setExitCodeFn(classified.exitCode);
    return classified.exitCode;
  }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js"))
) {
  void runAgentMain();
}
