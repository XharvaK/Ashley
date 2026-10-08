import type { ThoughtParseRate } from "../agent-client.js";

/** One /status line of Thought answers per model over 24 h; null when there are no rows. */
export function renderThoughtParseRates(rates?: ThoughtParseRate[]): string | null {
  if (!rates || rates.length === 0) return null;
  const perModel = rates.map((rate) =>
    `${rate.modelId}: ${rate.malformed} malformed of ${rate.returned + rate.malformed}`);
  return `Thought answers, 24h: ${perModel.join("; ")}`;
}
