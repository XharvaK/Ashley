import { publishFieldLabArtifacts } from "../publisher.js";
import type { PublishOptions } from "../types.js";

function parseArgs(argv: string[]): PublishOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) throw new Error("argument_invalid");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`argument_missing:${flag}`);
    values.set(flag.slice(2), value);
    index += 1;
  }
  const required = ["artifacts", "field-lab", "field-day", "bundle-id", "observer-pass-id"];
  for (const key of required) if (!values.has(key)) throw new Error(`argument_missing:--${key}`);
  return {
    artifactsRoot: values.get("artifacts")!,
    fieldLabWorktree: values.get("field-lab")!,
    fieldDay: values.get("field-day")!,
    bundleId: values.get("bundle-id")!,
    observerPassId: values.get("observer-pass-id")!,
    remote: values.get("remote"),
    branch: values.get("branch"),
  };
}

try {
  console.log(JSON.stringify(await publishFieldLabArtifacts(parseArgs(process.argv.slice(2)))));
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "field_lab_publish_failed";
  console.error(code);
  process.exitCode = 1;
}
