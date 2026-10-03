import { describe, expect, it } from "vitest";
import * as run from "./run.js";
describe("self-change result delivery origin", () => {
 it("retains a proactive result trigger instead of reactive Owner provenance", () => {
  expect(typeof run.deliveryIntentFor).toBe("function");
  const intent = run.deliveryIntentFor({ conversationId: "private", triggerKind: "self_change_result", occupantId: "doc" }, { ownerId: "doc" }, "licensed_speech");
  expect(intent.trigger).toBe("self_change_result"); expect(intent.deliveryLane).toBe("proactive");
 });
});
