const SECRETISH =
  /\b(sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{8,}|Bearer\s+eyJ[A-Za-z0-9._-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;

/** Discord bot token shape: base64 user id, timestamp, HMAC (A13-14). */
const DISCORD_TOKEN_SHAPE = /\b[MNO][A-Za-z\d_-]{23,28}\.[A-Za-z\d_-]{6,7}\.[A-Za-z\d_-]{27,}\b/g;

/**
 * Named secret assignments, in env-file or header form. The value after the name
 * is replaced; the name stays so the log still says what was redacted.
 */
const NAMED_SECRET_ASSIGNMENT =
  /\b(COMMAND_CODE_API_KEY|DISCORD_BOT_TOKEN|ASHLEY_SERVICE_TOKEN|DOMUS_HELPER_TOKEN|X-Ashley-Bot-Service)(\s*[:=]\s*)[^\s,;"']+/gi;

const REDACTED = "[redacted-credential]";
const MIN_LITERAL_LENGTH = 8;

/** Live secret values registered at boot. Matched literally, so any shape is covered. */
const knownSecretValues = new Set<string>();

/** Register the secret values this process holds (token, helper token, provider keys). */
export function registerSecretValues(values: ReadonlyArray<string | undefined>): void {
  for (const value of values) {
    const trimmed = value?.trim() ?? "";
    if (trimmed.length >= MIN_LITERAL_LENGTH) knownSecretValues.add(trimmed);
  }
}

/** Scrub credential-shaped substrings and known secret values from logs/errors. Never echo raw secrets. */
export function redactSecretShapes(text: string): string {
  let safe = text;
  // Longest first, so a value that contains another is replaced whole.
  for (const value of [...knownSecretValues].sort((a, b) => b.length - a.length)) {
    safe = safe.split(value).join(REDACTED);
  }
  return safe
    .replace(SECRETISH, REDACTED)
    .replace(DISCORD_TOKEN_SHAPE, REDACTED)
    .replace(NAMED_SECRET_ASSIGNMENT, (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`);
}

function redactArg(arg: unknown): unknown {
  if (typeof arg === "string") return redactSecretShapes(arg);
  if (arg instanceof Error) {
    const text = arg.stack ?? `${arg.name}: ${arg.message}`;
    return redactSecretShapes(text);
  }
  return arg;
}

const WRAPPED = Symbol.for("ashley.redacted-console");

/**
 * Route the console's string and error output through the redactor (A13-14). Object
 * arguments pass through unchanged; a secret is not expected inside them.
 */
export function installConsoleRedaction(target: Console = console): void {
  const marked = target as unknown as Record<symbol, boolean>;
  if (marked[WRAPPED]) return;
  marked[WRAPPED] = true;
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    if (typeof target[method] !== "function") continue;
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => original(...args.map(redactArg));
  }
}
