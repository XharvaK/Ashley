import { describe, expect, it } from "vitest";
import { fidelityCheck } from "./fidelity.js";
import type { ExistingRef, Observation } from "../types.js";

const commitments = {
  epistemic: [{
    dimensions: {
      source: "owner_utterance" as const,
      status: "asserted" as const,
      time: "current" as const,
      reliability: "owner_supplied" as const,
    },
    statement: "HY4 is the selected item",
  }],
  conversational: ["answer" as const],
  stance: {
    warmth: "medium" as const,
    humorAllowed: false,
    disagreement: false,
    uncertaintyDisplay: true,
  },
};

describe("v0.2.1 speech fidelity", () => {
  it("requires a draft and preserves mustSay/mustNot", () => {
    expect(fidelityCheck({
      mode: "draft",
      draft: "HY4 is the selected item",
      mustSay: ["HY4"],
      mustNot: ["HY3"],
      acceptableRealizations: [],
      commitments,
    })).toMatchObject({ ok: true });

    expect(fidelityCheck({
      mode: "draft",
      draft: "HY3 is the selected item",
      mustSay: ["HY4"],
      mustNot: [],
      acceptableRealizations: [],
      commitments,
    })).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("rejects forbidden text while allowing ordinary sparse draft speech", () => {
    expect(fidelityCheck({
      mode: "draft",
      draft: "HY4 and HY3",
      mustSay: [],
      mustNot: ["HY3"],
      acceptableRealizations: [],
      commitments,
    })).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });

    expect(fidelityCheck({
      mode: "draft",
      draft: "some words",
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: { ...commitments, epistemic: [], conversational: [] },
    })).toMatchObject({ ok: true });
  });

  it("does not use acceptable realizations to satisfy mustSay", () => {
    expect(fidelityCheck({
      mode: "draft",
      draft: "I selected the item.",
      mustSay: ["HY4"],
      mustNot: [],
      acceptableRealizations: ["I selected the item."],
      commitments,
    })).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("treats private silence as a successful settlement", () => {
    expect(fidelityCheck({
      mode: "none",
      draft: null,
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: { ...commitments, conversational: [] },
    })).toMatchObject({ ok: true });
  });

  it("rejects affirmative effect claims without structured operational success commitment", () => {
    // Surface claims completed/done without operational commitment
    expect(fidelityCheck({
      mode: "draft",
      draft: "I completed the task and it worked.",
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: { ...commitments, operational: [] },
    })).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });

    // Surface claims completed with matching operational success commitment -> ok
    expect(fidelityCheck({
      mode: "draft",
      draft: "I completed the task and it worked.",
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: {
        ...commitments,
        operational: [{ effectRef: "effect:test", claimedState: "succeeded" }],
      },
    })).toMatchObject({ ok: true });
  });

  it("rejects currentness claims without structured current epistemic commitment", () => {
    // Surface claims currentness with only historical commitment
    expect(fidelityCheck({
      mode: "draft",
      draft: "Currently, the status is active right now.",
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: {
        ...commitments,
        epistemic: [{
          dimensions: {
            source: "owner_utterance" as const,
            status: "asserted" as const,
            time: "historical" as const,
            reliability: "owner_supplied" as const,
          },
          statement: "The status was active",
        }],
      },
    })).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("SW-4 does not mistake questions, reported speech, or self-reference for success claims", () => {
    const ordinary = (draft: string) => fidelityCheck({
      mode: "draft",
      draft,
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: { ...commitments, operational: [] },
    });

    expect(ordinary("Are you done for tonight?")).toMatchObject({ ok: true });
    expect(ordinary("They said, \"I completed the task.\"")).toMatchObject({ ok: true });
    expect(ordinary("I haven't completed the task yet.")).toMatchObject({ ok: true });
    expect(ordinary("I will complete the task tomorrow.")).toMatchObject({ ok: true });
    expect(ordinary("I completed my thought and finished speaking.")).toMatchObject({ ok: true });
    expect(ordinary("I completed the task.")).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
    expect(ordinary("I completed the project.")).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });

    expect(fidelityCheck({
      mode: "draft",
      draft: "The task completed successfully.",
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: { ...commitments, operational: [{ effectRef: "effect:test", claimedState: "succeeded" }] },
    })).toMatchObject({ ok: true });
  });

  it("SW-4 does not mistake reported or interrogative currentness for a claim", () => {
    const ordinary = (draft: string) => fidelityCheck({
      mode: "draft",
      draft,
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: { ...commitments, epistemic: [] },
    });

    expect(ordinary("That's the latest I heard.")).toMatchObject({ ok: true });
    expect(ordinary("What's the latest status?")).toMatchObject({ ok: true });
    expect(ordinary("They mentioned that the latest status was healthy.")).toMatchObject({ ok: true });
    expect(ordinary("The latest status is healthy.")).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });

    expect(fidelityCheck({
      mode: "draft",
      draft: "The latest status is healthy.",
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments,
    })).toMatchObject({ ok: true });
  });

  it("SW-4 keeps vision and reading honesty checks for direct claims only", () => {
    const ordinary = (draft: string) => fidelityCheck({
      mode: "draft",
      draft,
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: { ...commitments, operational: [] },
    });

    expect(ordinary("Can you see the image?")).toMatchObject({ ok: true });
    expect(ordinary("They said, \"I can see the image.\"")).toMatchObject({ ok: true });
    expect(ordinary("I can't claim I can see the image.")).toMatchObject({ ok: true });
    expect(ordinary("I can see the image.")).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
    expect(fidelityCheck({
      mode: "draft",
      draft: "I can see the image.",
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: {
        ...commitments,
        operational: [],
        epistemic: [{
          dimensions: {
            source: "perception" as const,
            status: "asserted" as const,
            time: "historical" as const,
            reliability: "fallible_observation" as const,
          },
          statement: "Ashley saw the image",
          surfaceSpan: "I can see the image.",
          observationRefs: ["obs-image-2" as ExistingRef],
        }],
      },
      observations: [{ observationId: "obs-image-2", modality: "image" }],
    })).toMatchObject({ ok: true });
    expect(ordinary("Did you read the page?")).toMatchObject({ ok: true });
    expect(ordinary("They reported, \"I read the page.\"")).toMatchObject({ ok: true });
    expect(ordinary("I can't claim I read the page.")).toMatchObject({ ok: true });
    expect(ordinary("I read the page.")).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
    expect(fidelityCheck({
      mode: "draft",
      draft: "I read the page.",
      mustSay: [],
      mustNot: [],
      acceptableRealizations: [],
      commitments: {
        ...commitments,
        operational: [],
        epistemic: [{
          dimensions: {
            source: "tool" as const,
            status: "asserted" as const,
            time: "historical" as const,
            reliability: "fallible_observation" as const,
          },
          statement: "Ashley read the page",
          surfaceSpan: "I read the page.",
          observationRefs: ["obs-page-1" as ExistingRef],
        }],
      },
      observations: [{ observationId: "obs-page-1", modality: "page" }],
    })).toMatchObject({ ok: true });
  });
});

const TOOL_DIMS = {
  source: "tool" as const,
  status: "asserted" as const,
  time: "historical" as const,
  reliability: "fallible_observation" as const,
};

const INTERP_DIMS = {
  source: "ashley_interpretation" as const,
  status: "interpreted" as const,
  time: "historical" as const,
  reliability: "inferred" as const,
};

const PAGE_OBS: readonly Pick<Observation, "observationId" | "modality">[] = [{ observationId: "obs-page-1", modality: "page" }];
const TOOL_OBS: readonly Pick<Observation, "observationId" | "modality">[] = [{ observationId: "v021:observation:req-1", modality: "tool" }];
const TEXT_OBS: readonly Pick<Observation, "observationId" | "modality">[] = [{ observationId: "obs-text-9", modality: "text" }];
const IMAGE_OBS: readonly Pick<Observation, "observationId" | "modality">[] = [{ observationId: "obs-image-2", modality: "image" }];

function boundCheck(
  draft: string,
  epistemic: unknown[],
  observations: readonly Pick<Observation, "observationId" | "modality">[] = [],
) {
  return fidelityCheck({
    mode: "draft",
    draft,
    mustSay: [],
    mustNot: [],
    acceptableRealizations: [],
    commitments: { ...commitments, operational: [], epistemic: epistemic as never[] },
    observations,
  });
}

function toolClaim(span: string, refs: string[]) {
  return { dimensions: { ...TOOL_DIMS }, statement: "external claim", surfaceSpan: span, observationRefs: refs };
}

describe("F2 claim-evidence-surface binding", () => {
  it("accepts the lived idiom with a valid interpretation binding", () => {
    expect(boundCheck(
      "yeah \u2014 I read 'online' as reachable again, not gone",
      [{
        dimensions: { ...INTERP_DIMS },
        statement: "Ashley interprets online as reachable",
        surfaceSpan: "I read 'online' as reachable again",
      }],
    )).toMatchObject({ ok: true });
  });

  it("rejects the lived idiom sparse: detectors still fire, ambient licenses nothing", () => {
    expect(boundCheck(
      "yeah \u2014 I read 'online' as reachable again, not gone",
      [],
      TEXT_OBS,
    )).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("rejects a real reading claim with only unrelated ambient text evidence", () => {
    expect(boundCheck(
      "I read the Cloudflare documentation.",
      [],
      TEXT_OBS,
    )).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("accepts a real reading claim with its own page ref", () => {
    expect(boundCheck(
      "I read the Cloudflare documentation.",
      [toolClaim("I read the Cloudflare documentation.", ["obs-page-1"])],
      PAGE_OBS,
    )).toMatchObject({ ok: true });
  });

  it("accepts a project read bound to a modality=tool observation (F2-P)", () => {
    expect(boundCheck(
      "I read the project file.",
      [toolClaim("I read the project file.", ["v021:observation:req-1"])],
      TOOL_OBS,
    )).toMatchObject({ ok: true });
  });

  it("rejects a project read without binding (F2-P)", () => {
    expect(boundCheck("I read the project file.", [], TOOL_OBS))
      .toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("rejects concrete unsupported discovery (F2-F)", () => {
    expect(boundCheck("I found the bug in production.", [], TOOL_OBS))
      .toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("accepts governed discovery bound to a tool observation (F2-G)", () => {
    expect(boundCheck(
      "I found the bug in production.",
      [toolClaim("I found the bug in production.", ["v021:observation:req-1"])],
      TOOL_OBS,
    )).toMatchObject({ ok: true });
  });

  it("accepts benign found-polysemy via interpretation span (F2-H)", () => {
    expect(boundCheck(
      "I found the idea interesting.",
      [{
        dimensions: { ...INTERP_DIMS },
        statement: "Ashley found the idea interesting",
        surfaceSpan: "I found the idea interesting.",
      }],
    )).toMatchObject({ ok: true });
  });

  it("rejects vision with only unrelated ambient image evidence", () => {
    expect(boundCheck("I can see the image.", [], IMAGE_OBS))
      .toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("rejects a valid page claim plus an unsupported second external claim (F2-C/D)", () => {
    expect(boundCheck(
      "I read the Cloudflare documentation. I read the NVIDIA documentation.",
      [toolClaim("I read the Cloudflare documentation.", ["obs-page-1"])],
      PAGE_OBS,
    )).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("accepts page-backed C1 plus image-backed C2 (F2-B)", () => {
    expect(boundCheck(
      "I read the Cloudflare documentation. I can see the image.",
      [
        toolClaim("I read the Cloudflare documentation.", ["obs-page-1"]),
        {
          dimensions: { source: "perception" as const, status: "asserted" as const, time: "historical" as const, reliability: "fallible_observation" as const },
          statement: "Ashley saw the image",
          surfaceSpan: "I can see the image.",
          observationRefs: ["obs-image-2"],
        },
      ],
      [...PAGE_OBS, ...IMAGE_OBS],
    )).toMatchObject({ ok: true });
  });

  it("rejects a rewritten evidence-bound span (F2-J)", () => {
    expect(boundCheck(
      "I read the Cloudflare docs.",
      [toolClaim("I read the Cloudflare documentation.", ["obs-page-1"])],
      PAGE_OBS,
    )).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("rejects a dropped evidence-bound span even when the remainder is clean", () => {
    expect(boundCheck(
      "Understood, moving on.",
      [toolClaim("I read the Cloudflare documentation.", ["obs-page-1"])],
      PAGE_OBS,
    )).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("rejects a duplicated evidence-bound span (F2-O)", () => {
    expect(boundCheck(
      "I read the page. I read the page.",
      [toolClaim("I read the page.", ["obs-page-1"])],
      PAGE_OBS,
    )).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("rejects overlapping occurrences of an evidence-bound span", () => {
    expect(boundCheck(
      "I read I read I",
      [toolClaim("I read I", ["obs-page-1"])],
      PAGE_OBS,
    )).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("accepts a harmlessly dropped interpretive span when the remainder is clean", () => {
    expect(boundCheck(
      "Understood, moving on.",
      [{
        dimensions: { ...INTERP_DIMS },
        statement: "Ashley interprets online as reachable",
        surfaceSpan: "I read 'online' as reachable again",
      }],
    )).toMatchObject({ ok: true });
  });

  it("rejects a duplicated interpretive span", () => {
    expect(boundCheck(
      "I see what you mean. I see what you mean.",
      [{
        dimensions: { ...INTERP_DIMS },
        statement: "Ashley follows the owner",
        surfaceSpan: "I see what you mean.",
      }],
    )).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("rejects overlapping occurrences of an interpretive span", () => {
    expect(boundCheck(
      "I read I read I",
      [{
        dimensions: { ...INTERP_DIMS },
        statement: "Ashley interprets the phrase",
        surfaceSpan: "I read I",
      }],
    )).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("rejects overlapping bound spans", () => {
    expect(boundCheck(
      "I read the page and I read the article today.",
      [
        toolClaim("I read the page and I read", ["obs-page-1"]),
        toolClaim("I read the article", ["obs-page-1"]),
      ],
      PAGE_OBS,
    )).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("rejects a reading span warranted only by an image observation", () => {
    expect(boundCheck(
      "I read the Cloudflare documentation.",
      [toolClaim("I read the Cloudflare documentation.", ["obs-image-2"])],
      IMAGE_OBS,
    )).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("rejects a claim citing an unknown observation", () => {
    expect(boundCheck(
      "I read the Cloudflare documentation.",
      [toolClaim("I read the Cloudflare documentation.", ["obs-ghost"])],
      PAGE_OBS,
    )).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("rejects a detector-vacuous span with an unknown observation", () => {
    expect(boundCheck(
      "This is harmless.",
      [toolClaim("This is harmless.", ["obs-ghost"])],
      PAGE_OBS,
    )).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("accepts a detector-vacuous span with a real observation and masks nothing", () => {
    expect(boundCheck(
      "This is harmless.",
      [toolClaim("This is harmless.", ["obs-page-1"])],
      PAGE_OBS,
    )).toMatchObject({ ok: true });
    expect(boundCheck(
      "This is harmless. I read the project file.",
      [toolClaim("This is harmless.", ["obs-page-1"])],
      PAGE_OBS,
    )).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("does not let an unbound external commitment license a high-risk claim", () => {
    expect(boundCheck(
      "I read the project file.",
      [{ dimensions: { ...TOOL_DIMS }, statement: "an unbound external fact" }],
      TOOL_OBS,
    )).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });

  it("requires every fired class inside one span to be warranted", () => {
    expect(boundCheck(
      "I read the page and I see the image.",
      [toolClaim("I read the page and I see the image.", ["obs-page-1"])],
      [...PAGE_OBS, ...IMAGE_OBS],
    )).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
    expect(boundCheck(
      "I read the page and I see the image.",
      [toolClaim("I read the page and I see the image.", ["obs-page-1", "obs-image-2"])],
      [...PAGE_OBS, ...IMAGE_OBS],
    )).toMatchObject({ ok: true });
  });

  it("does not let other-source spans suppress the backstop", () => {
    expect(boundCheck(
      "I read the Cloudflare documentation.",
      [{
        dimensions: {
          source: "owner_utterance" as const,
          status: "asserted" as const,
          time: "historical" as const,
          reliability: "owner_supplied" as const,
        },
        statement: "owner mentioned docs",
        surfaceSpan: "I read the Cloudflare documentation.",
      }],
      PAGE_OBS,
    )).toMatchObject({ ok: false, code: "UNWITNESSED_HIGH_RISK_CLAIM" });
  });
});
