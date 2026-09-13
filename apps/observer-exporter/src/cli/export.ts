import { exportFieldObservation, preflightExporter } from "../exporter.js";
import type { ExportOptions } from "../types.js";

function parseArgs(argv: string[]): ExportOptions & { preflight: boolean } {
  const values = new Map<string, string>();
  let preflight = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--preflight") {
      preflight = true;
      continue;
    }
    if (!flag?.startsWith("--")) throw new Error("argument_invalid");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`argument_missing:${flag}`);
    values.set(flag.slice(2), value);
    index += 1;
  }
  const required = ["data-root", "out-root", "ashley-checkout", "field-day"];
  for (const key of required) if (!values.has(key)) throw new Error(`argument_missing:--${key}`);
  return {
    dataRoot: values.get("data-root")!,
    outRoot: values.get("out-root")!,
    ashleyCheckout: values.get("ashley-checkout")!,
    fieldDay: values.get("field-day")!,
    closedAsOf: values.get("closed-as-of"),
    preflight,
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.preflight) {
    console.log(JSON.stringify(await preflightExporter(options)));
  } else {
    console.log(JSON.stringify(await exportFieldObservation(options)));
  }
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "observer_export_failed";
  console.error(code);
  process.exitCode = 1;
}
