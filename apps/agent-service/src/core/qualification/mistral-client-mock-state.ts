import { vi } from "vitest";

/**
 * Shared, mutable mock state for the Wave 4 `mistral-client.js` mock.
 *
 * The capture arrays live here (not inside the `vi.mock` factory) so that both
 * the mock factory AND the test files reference the SAME array instances. ESM
 * module namespaces are frozen, so returning an ad-hoc `__caps` export from the
 * factory is not observable by tests — but a shared imported binding is.
 */

export type Capture = {
  messages: unknown[];
  options: Record<string, unknown>;
  returned: unknown;
};

export const expressionCapture: Capture[] = [];
export const thoughtCapture: Capture[] = [];

export function clearCaptures(): void {
  expressionCapture.length = 0;
  thoughtCapture.length = 0;
}

export function makeFakeCompleteChat() {
  return vi.fn(async (messages: unknown[], options: Record<string, unknown> = {}) => {
    const route = (options.route as string) ?? "unknown";
    const capture: Capture = { messages, options, returned: "" };
    if (route === "ashley_expression") {
      const text = "RESPONSE_SENTINEL";
      capture.returned = text;
      expressionCapture.push(capture);
      return { text, model: "fake", modelAlias: "fake", resolvedModelId: "fake", attentionRequestId: 1 };
    }
    if (route === "thought") {
      const json = JSON.stringify({
        decision: {
          kind: "share",
          certainty: 0.6,
          uncertainty: 0,
          urgency: 0.1,
          cognitiveAllocation: { shouldSpeak: true, effort: "medium", completion: "complete" },
          stanceReasoning: "SHADOW_THOUGHT_SENTINEL",
          boundaryReasoning: "",
          sourceReasoning: "",
          affectDelta: { valence: 0, activation: 0, openness: 0, tension: 0 },
        },
        thought: "SHADOW_THOUGHT_SENTINEL",
      });
      capture.returned = json;
      thoughtCapture.push(capture);
      return { text: json, model: "fake", modelAlias: "fake", resolvedModelId: "fake", attentionRequestId: 2 };
    }
    throw new Error(`wave4-mock: unexpected completeChat route "${route}" with options ${JSON.stringify(options)}`);
  });
}
