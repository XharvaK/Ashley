import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import type { KernelDeps } from "../types.js";
import {
  CONTROL_INTERPRETATION_SCHEMA_FINGERPRINT,
  type ControlInterpretationResult,
} from "../../relationship/control-admission.js";
import { runControlInterpretationPhase } from "./run.js";

describe("bounded control interpretation phase", () => {
  it("uses the separate constrained schema and returns a phase result without ordinary Thought fields", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const calls: Array<{ messages: unknown[]; options: Record<string, unknown> }> = [];
    try {
      const completeChat = (async (messages: unknown[], options: Record<string, unknown>) => {
        calls.push({ messages, options });
        return { text: JSON.stringify({ kind: "none" }) };
      }) as unknown as KernelDeps["completeChat"];
      const result = await runControlInterpretationPhase({
        sourceRef: "owner-evidence-1",
        messageId: "discord-owner-message-1",
        message: "hello there",
        sourceSpan: { start: 0, end: 11 },
        candidatePrincipalRefs: [{ kind: "mention", userId: "person-1", messageId: "discord-owner-message-1" }],
      }, { attentionDb: db, completeChat }, { ownerId: "owner-1", requestId: "control-request-1" });
      expect(result.result).toEqual<ControlInterpretationResult>({ kind: "none" });
      expect(calls).toHaveLength(1);
      expect(calls[0].options.responseFormat).toBe("json_schema");
      expect((calls[0].options.structuredOutput as { schemaFingerprint: string }).schemaFingerprint)
        .toBe(CONTROL_INTERPRETATION_SCHEMA_FINGERPRINT);
      expect(calls[0].options.tools).toBeUndefined();
      expect(JSON.stringify(calls[0].messages)).toContain("hello there");
    } finally {
      db.close();
    }
  });

  it("rejects a provider response that attempts to emit ordinary speech or a Host identity", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const completeChat = (async () => ({
        text: JSON.stringify({ kind: "proposals", proposals: [{ kind: "settlement", proposalId: "model-id" }] }),
      })) as unknown as KernelDeps["completeChat"];
      await expect(runControlInterpretationPhase({
        sourceRef: "owner-evidence-2",
        messageId: "discord-owner-message-2",
        message: "you can talk to Lyra",
      }, { attentionDb: db, completeChat })).rejects.toThrow("control_phase_violation");
    } finally {
      db.close();
    }
  });
});
