const SECRETISH =
  /\b(sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{8,}|Bearer\s+eyJ[A-Za-z0-9._-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;

/** Scrub credential-shaped substrings from logs/errors. Never echo raw secrets. */
export function redactSecretShapes(text: string): string {
  return text.replace(SECRETISH, "[redacted-credential]");
}
