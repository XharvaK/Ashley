import { describe, expect, it } from "vitest";
import { isSilenceRequest } from "./motivations.js";
import { decide } from "./decide.js";
import type { Motivation } from "../types.js";

function motivation(
  kind: Motivation["kind"],
  score: number,
  summary: string,
): Motivation {
  return { id: score, kind, score, summary };
}

describe("silence-intent grammar and Agency decision consistency", () => {
  // 1. Exact M6 utterance
  it("does NOT classify the exact M6 bounded operation utterance as silence", () => {
    const m6Utterance =
      "Using the bounded operation capability, perform this finite Project Ashley candidate-only sequence: create a fresh candidate file called `ashley-m6-smoke.txt` containing `M6 bounded operation smoke test`, mechanically verify that candidate using the available verification capability, then seal the resulting candidate work as an advisory change-set. Do not touch the live repository. Do not apply, merge, commit, push, export, deploy, restart, install anything, or use network access. Stop after the advisory change-set is sealed, and tell me what actually happened at each step.";

    expect(isSilenceRequest(m6Utterance)).toBe(false);

    // When presented as a user message motivation, Agency MUST speak (dispatch to Thought), NOT deterministically silence
    const result = decide(
      [motivation("user_message", 100, m6Utterance)],
      "reactive",
    );
    expect(result.kind).toBe("speak");
    expect(result.cognitiveAllocation.shouldSpeak).toBe(true);
  });

  // 2. Positive silence regressions
  describe("positive conversational space requests", () => {
    const positiveCases = [
      "stop",
      "please stop",
      "stop.",
      "STOP!",
      "stop messaging me",
      "stop pinging me",
      "stop talking to me",
      "stop replying",
      "don't message me",
      "do not message me",
      "don't ping me",
      "do not ping me",
      "leave me alone",
      "not now",
      "busy",
      "I'm busy, talk later",
      "talk later",
      "later",
      "give me space",
      "please give me space",
      "i need some space",
    ];

    for (const phrase of positiveCases) {
      it(`identifies "${phrase}" as silence request`, () => {
        expect(isSilenceRequest(phrase)).toBe(true);

        const result = decide(
          [motivation("user_message", 100, phrase)],
          "reactive",
        );
        expect(result.kind).toBe("silence");
        expect(result.cognitiveAllocation.shouldSpeak).toBe(false);
      });
    }
  });

  // 3. Procedural `stop` regressions
  describe("procedural / operational stop constraints", () => {
    const proceduralCases = [
      "Stop after the operation completes.",
      "Stop when verification fails.",
      "Stop once the patch is sealed.",
      "Stop before applying anything.",
      "Run at most three attempts and stop.",
      "If the compiler fails, stop and report the error.",
      "Create the file, verify it, then stop.",
      "Don't stop until the bounded operation settles.",
      "Never stop the service.",
      "Stop on failure.",
      "Stop at step 3.",
      "Stop following the build.",
      "Stop upon error.",
    ];

    for (const phrase of proceduralCases) {
      it(`does NOT classify procedural phrase "${phrase}" as silence`, () => {
        expect(isSilenceRequest(phrase)).toBe(false);

        const result = decide(
          [motivation("user_message", 100, phrase)],
          "reactive",
        );
        expect(result.kind).toBe("speak");
        expect(result.cognitiveAllocation.shouldSpeak).toBe(true);
      });
    }
  });

  // 4. Negation / quotation / discussion cases
  describe("negation, quotation, and discussion cases", () => {
    const discussionCases = [
      "The word 'stop' is causing a bug.",
      "Why did Ashley stop responding?",
      "Don't interpret 'stop after' as silence.",
      "Would you stop after step 3?",
      "Can you stop the server?",
      "Please do not stop the test.",
    ];

    for (const phrase of discussionCases) {
      it(`does NOT classify discussion phrase "${phrase}" as silence`, () => {
        expect(isSilenceRequest(phrase)).toBe(false);

        const result = decide(
          [motivation("user_message", 100, phrase)],
          "reactive",
        );
        expect(result.kind).toBe("speak");
        expect(result.cognitiveAllocation.shouldSpeak).toBe(true);
      });
    }
  });
});
