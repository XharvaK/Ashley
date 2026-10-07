import { describe, expect, it } from "vitest";
import type { ThoughtInput } from "../types.js";
import { buildCoverageManifest } from "./coverage-manifest.js";
import { buildOrientationKernel } from "./orientation-kernel.js";
import { createPrefixMeter } from "./prefix-meter.js";
import { allocateThoughtProjection } from "./projection-allocator/allocator.js";
import type { DomainPointersSection } from "./domain-pointers.js";

/**
 * Mirrors `volatileFields` in projection-allocator/allocator.ts. The prefix
 * may change at one of these top-level keys and nowhere earlier.
 */
const VOLATILE_FIELDS = new Set([
  "cycleId",
  "generation",
  "trigger",
  "wakeCauses",
  "previousInvocationDelta",
  "thoughtLegDeadlineAtMs",
  "clock",
  "episodes",
  "activityJournal",
  "growth",
  "innerPass",
  "domus",
  "domusNow",
  "places",
  "home",
  "will",
  "placeWish",
  "teacher",
  "pendingForget",
  "rawConversation",
  "deskEntries",
  "observations",
  "retrieval",
  "workingContextSelection",
  "inFlight",
  "authorityObjections",
  "runtimeCondition",
  "rememberDirective",
  "conversationSelection",
]);

/** Room for the JSON punctuation that sits on the volatile key itself. */
const JSON_KEY_SLACK = 32;

const RELEASE_ROWS = [{
  capability: "vision",
  releaseId: "rel-prefix",
  state: "active",
  updatedAt: "2026-10-01T00:00:00.000Z",
  contractId: "contract-vision",
  buildIdentity: null,
  modelEpoch: 1,
}] as const;

const BASE_ROW: ThoughtInput["rawConversation"][number] = {
  rowId: "row-1",
  lineageId: "lin-1",
  version: 1,
  conversationId: "conv-1",
  role: "owner",
  text: "Hello Ashley, let's test allocation",
  createdAtMs: 1_699_999_000_000,
  discordMessageIds: [],
  reservationId: null,
  producingCycleId: null,
  architectureEpoch: "v0.2.1",
  contentHash: "hash1",
  sourceStatus: "delivered",
  dataClassification: "ordinary",
  secretOmitted: false,
  delivered: true,
};

function capability(capturedAtMs: number): ThoughtInput["capabilityReality"] {
  return {
    vision: false,
    attachmentText: false,
    conversationalRead: false,
    webSearch: false,
    canOfferProjectInspection: false,
    canOfferWorkspace: false,
    canOfferVerification: false,
    canOfferAuthorship: false,
    canOfferBoundedOperation: false,
    canOfferInquiry: false,
    canOfferPatchExport: false,
    approvedProjectIds: [],
    asOf: {
      capturedAtMs,
      releaseId: "rel-prefix",
      status: "present",
      releaseRows: RELEASE_ROWS.map((row) => ({ ...row })),
    },
  };
}

function thoughtInput(options: {
  capturedAtMs: number;
  clockNow: string;
  deadlineAtMs: number;
  rows: ThoughtInput["rawConversation"];
  cycleId?: string;
}): ThoughtInput & {
  orientationKernel: ReturnType<typeof buildOrientationKernel>;
  domainPointers: DomainPointersSection;
} {
  const input: ThoughtInput = {
    cycleId: options.cycleId ?? "cycle-prefix",
    generation: 1,
    occupantId: "occupant-1",
    authorityEpoch: 1,
    trigger: { kind: "owner_message", ref: "row-1" },
    rawConversation: options.rows,
    workingContext: [{
      id: "wc-topic-1",
      conversationId: "conv-1",
      type: "topic",
      text: "General discussion about architecture",
      concernId: null,
      sourceTurnIds: [],
      status: "active",
      supersedesId: null,
      updatedGeneration: 1,
    }],
    occupancy: [],
    constitution: { constitutional: ["Be truthful"], stableSelf: ["Project Ashley"] },
    learnedSelfSlice: { dispositions: ["disciplined"], interests: ["architecture"] },
    capabilityReality: capability(options.capturedAtMs),
    observations: [],
    retrieval: {
      request: {
        triggerTerms: ["architecture"],
        workingContextTopics: [],
        assertionKeys: [],
        includeLogSearch: true,
      },
      hits: [{
        kind: "lexical",
        sourceStore: "live_memory",
        ref: "mem:arch:1",
        snippet: "Project Ashley uses SQLite and unprivileged Bubblewrap",
        score: -5.0,
        assertionKey: "mem:arch:1",
        memoryKind: "owner_world_claim",
        dimensions: null,
        dataClassification: "ordinary",
        live: true,
        supportRefs: ["supp-1"],
      }],
      state: "ready",
      miss: false,
    },
    inFlight: [],
    authorityObjections: [],
    runtimeCondition: {
      fallback: false,
      compression: false,
      lookupFailed: false,
      thoughtUnavailable: false,
    },
    rememberDirective: null,
    thoughtLegDeadlineAtMs: options.deadlineAtMs,
    clock: {
      now: options.clockNow,
      timeZone: "UTC+03:00",
      partOfDay: "night",
    },
    growth: {
      mood: { valence: 0, energy: 0, baseline: { valence: 0, energy: 0 } },
      revisions: [],
    } as unknown as ThoughtInput["growth"],
  };
  const orientationKernel = buildOrientationKernel({
    values: ["synthetic value"],
    boundaries: ["synthetic boundary"],
    stableSelf: ["synthetic stable self"],
    staticOperatingContract: "Synthetic operating contract for allocation pressure tests.",
    capabilityReality: input.capabilityReality,
  });
  const domainPointers: DomainPointersSection = {
    version: 1,
    conversationId: "conv-1",
    cycleId: input.cycleId,
    pointers: [{
      domain: "synthetic_domain",
      canonicalStore: "synthetic.db:domain",
      entityIds: ["synthetic-entity"],
      status: "active",
      updatedAtMs: 1,
      disposition: "POINTER_ONLY",
      pointerOnly: true,
    }],
    coverageManifest: buildCoverageManifest([{
      domain: "synthetic_domain",
      disposition: "POINTER_ONLY",
      sourceRecordCount: 1,
      eligibleRecordCount: 1,
      candidateIds: ["synthetic-entity"],
      required: false,
      pointerOnly: true,
    }]),
  };
  return { ...input, orientationKernel, domainPointers };
}

describe("thought prompt prefix stability", () => {
  it("keeps the user message byte-identical until the first declared volatile field", () => {
    const first = allocateThoughtProjection({
      thoughtInput: thoughtInput({
        capturedAtMs: 1_700_000_000_000,
        clockNow: "Tuesday 29 September 2026, 22:13",
        deadlineAtMs: 1_700_000_000_000,
        rows: [BASE_ROW],
      }),
      requestId: "req-prefix-stability-a",
    });
    const second = allocateThoughtProjection({
      thoughtInput: thoughtInput({
        capturedAtMs: 1_700_000_120_000,
        clockNow: "Tuesday 29 September 2026, 22:15",
        deadlineAtMs: 1_700_000_120_000,
        rows: [BASE_ROW, {
          ...BASE_ROW,
          rowId: "row-2",
          text: "A later owner message",
          createdAtMs: 1_700_000_000_000,
          contentHash: "hash2",
        }],
      }),
      requestId: "req-prefix-stability-b",
    });

    expect(first.projected.orientationKernel?.capabilityReality.asOf?.capturedAtMs)
      .toBe(1_700_000_000_000);
    expect(second.projected.orientationKernel?.capabilityReality.asOf?.capturedAtMs)
      .toBe(1_700_000_120_000);
    expect(first.messages[0]?.content).toBe(second.messages[0]?.content);

    const visible = JSON.parse(first.messages[1]?.content ?? "{}") as {
      orientationKernel?: {
        capabilityReality?: { asOf?: Record<string, unknown> };
      };
    };
    const visibleKeys = Object.keys(JSON.parse(first.messages[1]?.content ?? "{}") as Record<string, unknown>);
    expect(visibleKeys.slice(0, 4)).toEqual([
      "orientationKernel",
      "learnedSelfSlice",
      "occupantId",
      "authorityEpoch",
    ]);
    const firstVolatileKey = visibleKeys.findIndex((key) => VOLATILE_FIELDS.has(key));
    expect(firstVolatileKey).toBeGreaterThanOrEqual(4);
    const firstPointers = (JSON.parse(first.messages[1]?.content ?? "{}") as {
      domainPointers?: Record<string, unknown>;
    }).domainPointers;
    const secondPointers = (JSON.parse(second.messages[1]?.content ?? "{}") as {
      domainPointers?: Record<string, unknown>;
    }).domainPointers;
    expect(firstPointers).not.toHaveProperty("cycleId");
    expect(JSON.stringify(firstPointers)).toBe(JSON.stringify(secondPointers));
    expect(first.projected.domainPointers?.cycleId).toBe("cycle-prefix");
    expect(visible.orientationKernel?.capabilityReality?.asOf).not.toHaveProperty("capturedAtMs");
    expect(visible.orientationKernel?.capabilityReality?.asOf).toMatchObject({
      releaseId: "rel-prefix",
      status: "present",
    });
    expect(visible.orientationKernel?.capabilityReality?.asOf?.releaseRows).toEqual([
      expect.objectContaining({ capability: "vision", state: "active", updatedAt: "2026-10-01T00:00:00.000Z" }),
    ]);

    const meter = createPrefixMeter();
    expect(meter.observe("prefix-stability", first.messages)).toBeNull();
    const report = meter.observe("prefix-stability", second.messages);
    expect(report).not.toBeNull();
    const systemBytes = first.receipt.diagnostics?.system_message_bytes ?? 0;
    const volatileOffset = first.receipt.diagnostics?.first_volatile_byte_offset;
    const head = report!.breakPath === "=" ? "=" : (report!.breakPath.split(/\.|\[/)[0] ?? "");
    expect(report!.breakMessage).toBe(1);
    expect(report!.breakPath === "=" || VOLATILE_FIELDS.has(head)).toBe(true);
    expect(typeof volatileOffset).toBe("number");
    expect(report!.stableBytes).toBeGreaterThanOrEqual(
      systemBytes + (volatileOffset as number) - JSON_KEY_SLACK,
    );
  });

  it("keeps visible domainPointers byte-identical when only the cycle id changes", () => {
    const shared = {
      capturedAtMs: 1_700_000_000_000,
      clockNow: "Tuesday 29 September 2026, 22:13",
      deadlineAtMs: 1_700_000_000_000,
      rows: [BASE_ROW],
    };
    const first = allocateThoughtProjection({
      thoughtInput: thoughtInput({ ...shared, cycleId: "cycle-prefix-a" }),
      requestId: "req-prefix-cycle-a",
    });
    const second = allocateThoughtProjection({
      thoughtInput: thoughtInput({ ...shared, cycleId: "cycle-prefix-b" }),
      requestId: "req-prefix-cycle-b",
    });

    expect(first.projected.domainPointers?.cycleId).toBe("cycle-prefix-a");
    expect(second.projected.domainPointers?.cycleId).toBe("cycle-prefix-b");
    const firstVisible = JSON.parse(first.messages[1]?.content ?? "{}") as {
      domainPointers?: Record<string, unknown>;
    };
    const secondVisible = JSON.parse(second.messages[1]?.content ?? "{}") as {
      domainPointers?: Record<string, unknown>;
    };
    expect(firstVisible.domainPointers).not.toHaveProperty("cycleId");
    expect(Object.keys(firstVisible.domainPointers ?? {})).toEqual([
      "version",
      "conversationId",
      "pointers",
      "coverageManifest",
    ]);
    expect(JSON.stringify(firstVisible.domainPointers)).toBe(JSON.stringify(secondVisible.domainPointers));
  });
});
