/**
 * The class and platform code of a failure, for logs. The message text is left
 * out on purpose: it can carry addresses or identifiers, while the class and the
 * code are enough to tell a fetch refusal from a bug.
 */
export function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return "non-error";
  const own = (error as Error & { code?: unknown }).code;
  const cause = (error as Error & { cause?: { code?: unknown } }).cause?.code;
  const codes = [own, cause].filter((value): value is string | number =>
    typeof value === "string" || typeof value === "number");
  return codes.length > 0 ? `${error.name} code=${codes.join("/")}` : error.name;
}
