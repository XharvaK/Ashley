import { vi } from "vitest";
import { makeFakeCompleteChat } from "./mistral-client-mock-state.js";

/**
 * Registers the `mistral-client.js` mock. Import this module from a test file
 * (its `vi.mock` is hoisted above all sibling imports, so it intercepts any
 * `runtime.ts` import of `mistral-client.js` before the real module loads).
 */
vi.mock("../../mistral-client.js", () => {
  const fn = makeFakeCompleteChat();
  return { completeChat: fn, default: { completeChat: fn } };
});
