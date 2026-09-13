import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import {
  buildCloudflareRequestBody,
  cloudflareRequestWireAdditionalBytes,
  cloudflareErrorClassFromBoundary,
  createCloudflareAdapter,
  isThoughtRouteAffinityEligible,
  mapCloudflareError,
  resolveThoughtRouteAffinity,
} from "./cloudflare-adapter.js";
import type { ChatMessage } from "../types.js";
import {
  providerBoundaryTransportFromError,
  providerHttpStatusFromBoundary,
} from "../types.js";
import {
  THOUGHT_OUTPUT_SCHEMA,
  THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
  thoughtOutputDeepSeekJsonObjectInstruction,
} from "../../cognitive-v021/thought/output-contract.js";
import { parseThoughtSemanticOutput } from "../../cognitive-v021/thought/parse.js";
import { validateThoughtOutputSchema } from "../../cognitive-v021/qualification/thought-capability-qualification.js";

const originalToken = env.cloudflareApiToken;
const originalAccount = env.cloudflareAccountId;
const originalAffinity = env.cloudflareThoughtAffinityId;
const MODEL = "@cf/nvidia/nemotron-3-120b-a12b";
const DEEPSEEK_MODEL = "@cf/deepseek-ai/deepseek-v4-flash-0731";
const messages: ChatMessage[] = [{ role: "user", content: "synthetic qualification input" }];

afterEach(() => {
  env.cloudflareApiToken = originalToken;
  env.cloudflareAccountId = originalAccount;
  env.cloudflareThoughtAffinityId = originalAffinity;
  vi.restoreAllMocks();
});

function fakeResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
  };
}

const structuredOutput = {
  kind: "native_json_schema" as const,
  contractId: "ashley.thought.semantic.v2",
  schemaId: "ashley.thought.semantic.v2.schema",
  schemaFingerprint: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
  bindingId: "compat_thought_cloudflare_nemotron_super_native_json_schema_v1",
  wireFormat: "cloudflare_response_format_json_schema" as const,
  schema: THOUGHT_OUTPUT_SCHEMA,
};

const deepseekStructuredOutput = {
  kind: "json_object_compatibility" as const,
  contractId: "ashley.thought.semantic.v2",
  schemaId: "ashley.thought.semantic.v2.schema",
  schemaFingerprint: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
  bindingId: "compat_thought_cloudflare_deepseek_v4_flash_json_object_v1",
};

const deepseekObservationStructuredOutput = {
  kind: "json_object_compatibility" as const,
  contractId: "ashley.thought.semantic.v2",
  schemaId: "ashley.thought.semantic.v2.schema",
  schemaFingerprint: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
  bindingId: "compat_thought_observation_cloudflare_deepseek_v4_flash_json_object_v1",
};

const deepseekReflectionStructuredOutput = {
  kind: "json_object_compatibility" as const,
  contractId: "ashley.thought.semantic.v2",
  schemaId: "ashley.thought.semantic.v2.schema",
  schemaFingerprint: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
  bindingId: "compat_reflection_cloudflare_deepseek_v4_flash_json_object_v1",
};

describe("cloudflare-adapter", () => {
  it("sends the direct Workers AI request with the frozen Thought controls", async () => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const adapter = createCloudflareAdapter(async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return fakeResponse(
        {
          id: "cf-request-1",
          model: MODEL,
          choices: [{
            message: { content: '{"act":"none"}', reasoning: "provider reasoning" },
            finish_reason: "stop",
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4,
            total_tokens: 14,
            cached_tokens: 2,
            neurons: 1166,
          },
        },
        { headers: { "cf-ai-neurons": "1166" } },
      );
    });

    const result = await adapter.dispatch({
      messages,
      modelId: MODEL,
      options: { maxTokens: 8192, temperature: 1.0 },
      fabricReasoning: { kind: "reasoning_effort", value: "high" },
      fabricStructuredOutput: structuredOutput,
    });
    const body = JSON.parse(capturedInit?.body as string) as Record<string, unknown>;

    expect(capturedUrl).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-test/ai/v1/chat/completions",
    );
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
    expect(body).toMatchObject({
      model: MODEL,
      max_completion_tokens: 8192,
      temperature: 1,
      reasoning_effort: "high",
      reasoning_budget: 1024,
    });
    expect(body.max_tokens).toBeUndefined();
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "ashley.thought.semantic.v2.schema",
        strict: true,
        schema: structuredOutput.schema,
      },
    });
    expect(JSON.stringify(body)).not.toContain("test-token");
    expect(result).toMatchObject({
      text: '{"act":"none"}',
      providerModel: MODEL,
      providerRequestId: "cf-request-1",
      providerHttpStatus: 200,
      finishReason: "stop",
      usage: {
        promptTokens: 10,
        completionTokens: 4,
        totalTokens: 14,
        cachedTokens: 2,
        neuronUsage: 1166,
      },
      wireEvidence: {
        adapterId: "ashley.adapter.cloudflare.v1",
        wireFormat: "cloudflare_response_format_json_schema",
        emittedEnforcementMode: "native_json_schema",
        bindingId: structuredOutput.bindingId,
      },
    });
    expect(result.text).not.toContain("provider reasoning");
    expect(result.responseDiagnostics?.reasoningContentBytes).toBeGreaterThan(0);
    expect(result.responseDiagnostics?.requestWireBytes).toBe(
      Buffer.byteLength(JSON.stringify(body), "utf8"),
    );
    expect(result.responseDiagnostics?.requestWireAdditionalBytes).toBe(
      cloudflareRequestWireAdditionalBytes({ body }),
    );
  });

  it("fails closed for untrusted schema requests", async () => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    const fetchFn = vi.fn(async () => fakeResponse({}));
    const adapter = createCloudflareAdapter(fetchFn);

    await expect(
      adapter.dispatch({
        messages,
        modelId: MODEL,
        options: { responseFormat: "json_schema" },
      }),
    ).rejects.toMatchObject({ code: "structured_output_untrusted" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not call the network when either credential is absent", async () => {
    const fetchFn = vi.fn(async () => fakeResponse({}));
    const adapter = createCloudflareAdapter(fetchFn);
    for (const [token, account] of [["", "account-test"], ["test-token", ""]]) {
      env.cloudflareApiToken = token;
      env.cloudflareAccountId = account;
      await expect(
        adapter.dispatch({ messages, modelId: MODEL, options: {} }),
      ).rejects.toMatchObject({ code: "agent_not_ready" });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [403, { errors: [{ code: 5035, message: "free plan restriction" }] }, "capability_mismatch", "free_plan_restriction"],
    [429, { errors: [{ code: 3036, message: "daily quota exhausted" }] }, "quota_exhausted", "daily_quota_exhausted"],
    [503, { errors: [{ code: 3040, message: "out of capacity" }] }, "provider_unavailable", "out_of_capacity"],
    [400, { error: { message: "JSON schema could not be met" } }, "capability_mismatch", "structured_output_failure"],
    [401, { error: { message: "invalid token" } }, "credential_invalid", "authentication"],
    [429, { error: { message: "busy" } }, "rate_limited", "rate_limited"],
    [500, { error: { message: "internal server error" } }, "provider_unavailable", "provider_unavailable"],
  ])("maps Cloudflare failure %s without leaking provider prose", async (status, body, code, failureClass) => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = createCloudflareAdapter(async () =>
      fakeResponse(body, { status, headers: { "retry-after": "9" } }),
    );
    const providerMessage = JSON.stringify(body);
    let error: unknown;
    try {
      await adapter.dispatch({ messages, modelId: MODEL, options: {} });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code });
    expect(providerHttpStatusFromBoundary(error)).toBe(status);
    expect(cloudflareErrorClassFromBoundary(error)).toBe(failureClass);
    expect(log.mock.calls.flat().join(" ")).not.toContain(providerMessage);
    if (code === "quota_exhausted" || code === "rate_limited") {
      expect((error as AppError).retryAfterSec).toBe(9);
    }
  });

  it("maps transport failures to bounded provider-unavailable metadata", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const mapped = mapCloudflareError(new TypeError("fetch failed"));
    expect(mapped).toMatchObject({ code: "provider_unavailable", httpStatus: 503 });
    expect(cloudflareErrorClassFromBoundary(mapped)).toBe("provider_unavailable");
    expect(log.mock.calls.flat().join(" ")).not.toContain("fetch failed");
  });

  it("rethrows deadline TimeoutError without inventing provider_unavailable", () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    expect(() => mapCloudflareError(err)).toThrow(err);
  });

  it("keeps genuine HTTP 503 and 429 classifications unchanged", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(mapCloudflareError({ statusCode: 503 })).toMatchObject({
        code: "provider_unavailable",
        httpStatus: 503,
      });
      expect(mapCloudflareError({ statusCode: 429 })).toMatchObject({
        code: "rate_limited",
        httpStatus: 429,
      });
    } finally {
      log.mockRestore();
    }
  });

  it("keeps the Cloudflare wire body separate from the canonical schema request", () => {
    const body = buildCloudflareRequestBody(
      messages,
      { maxTokens: 8192, temperature: 1 },
      MODEL,
      { kind: "reasoning_effort", value: "high" },
      structuredOutput,
    );
    expect(body.model).toBe(MODEL);
    expect(body.max_completion_tokens).toBe(8192);
    expect((body.response_format as { json_schema?: { schema?: unknown } }).json_schema?.schema)
      .toEqual(structuredOutput.schema);
    expect(cloudflareRequestWireAdditionalBytes({ body })).toBeGreaterThan(0);
  });

  it("uses JSON_OBJECT with a static schema-derived canonical protocol", () => {
    const body = buildCloudflareRequestBody(
      messages,
      { maxTokens: 8192, temperature: 1 },
      DEEPSEEK_MODEL,
      { kind: "reasoning_effort", value: "high" },
      deepseekStructuredOutput,
    );
    expect(body.response_format).toEqual({ type: "json_object" });
    const wireMessages = body.messages as Array<{ role: string; content: string }>;
    const protocol = thoughtOutputDeepSeekJsonObjectInstruction();
    expect(wireMessages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining(protocol),
    });
    expect(wireMessages[0]?.content).toContain("settlement");
    expect(wireMessages[0]?.content).toContain("observation_intent");
    expect(wireMessages[0]?.content).toContain("effect_intent");
    expect(wireMessages[0]?.content).toContain("abstain");
    expect(wireMessages[0]?.content).toContain("settlement example:");
    expect(wireMessages[0]?.content).not.toContain("qualification-fixture");
    expect(wireMessages[0]?.content).not.toContain("README.md");
    expect(thoughtOutputDeepSeekJsonObjectInstruction()).toBe(
      thoughtOutputDeepSeekJsonObjectInstruction(),
    );
    for (const branchValue of THOUGHT_OUTPUT_SCHEMA.oneOf as Array<Record<string, unknown>>) {
      const properties = branchValue.properties as Record<string, unknown>;
      const kind = (properties.kind as { const: string }).const;
      const required = branchValue.required as string[];
      expect(protocol).toContain(
        `${kind} fields=${JSON.stringify(Object.keys(properties))} required=${JSON.stringify(required)}`,
      );
    }
    expect(THOUGHT_OUTPUT_SCHEMA).toHaveProperty("oneOf");
    expect(body).not.toHaveProperty("response_format.json_schema");
  });

  it("returns DeepSeek semantic content unchanged and records JSON_OBJECT compatibility", async () => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    const semantic = JSON.stringify({
      kind: "effect_intent",
      operationKind: "workspace.verify",
      request: { version: 2, operation: "workspace.verify" },
      purpose: "run the approved verification",
      expectedOutcome: "the verification result is reported",
      existingRefs: ["turn-1"],
    });
    const adapter = createCloudflareAdapter(async () => fakeResponse({
      id: "cf-deepseek-request-1",
      model: DEEPSEEK_MODEL,
      choices: [{ message: { content: semantic }, finish_reason: "stop" }],
    }));

    const result = await adapter.dispatch({
      messages,
      modelId: DEEPSEEK_MODEL,
      options: { maxTokens: 8192, temperature: 1 },
      fabricReasoning: { kind: "reasoning_effort", value: "high" },
      fabricStructuredOutput: deepseekStructuredOutput,
    });

    expect(result.text).toBe(semantic);
    expect(parseThoughtSemanticOutput(result.text, new Set(["turn-1"]))).toMatchObject({ ok: true });
    expect(result.wireEvidence).toMatchObject({
      wireFormat: "json_object",
      emittedEnforcementMode: "json_object_compatibility",
      bindingId: deepseekStructuredOutput.bindingId,
    });
  });

  it("keeps canonical parser and validator rejection behavior for JSON_OBJECT content", () => {
    const valid = {
      kind: "abstain",
      reason: "insufficient_evidence",
      explanation: "The required source is unavailable.",
      evidenceRefs: [],
    };
    const polluted = {
      kind: "observation_intent",
      operationKind: "project.read_file",
      request: { projectId: "example-project", path: "example.txt" },
      purpose: "obtain an observation",
      evidenceNeed: "the requested evidence",
      existingRefs: [],
      subscriptionDeltas: [{ op: "cancel", target: "turn-1" }],
    };
    const missing = {
      kind: "observation_intent",
      operationKind: "project.read_file",
      request: { projectId: "example-project", path: "example.txt" },
      purpose: "obtain an observation",
      existingRefs: [],
    };
    const unknown = { ...valid, unexpected: true };

    const validParsed = parseThoughtSemanticOutput(JSON.stringify(valid), new Set());
    expect(validParsed).toMatchObject({ ok: true });
    expect(validateThoughtOutputSchema(validParsed.ok ? validParsed.value : null)).toMatchObject({ ok: true });

    const pollutedParsed = parseThoughtSemanticOutput(JSON.stringify(polluted), new Set());
    expect(pollutedParsed).toMatchObject({ ok: false });
    expect(validateThoughtOutputSchema(polluted)).toMatchObject({ ok: false });

    const missingParsed = parseThoughtSemanticOutput(JSON.stringify(missing), new Set());
    expect(missingParsed).toMatchObject({ ok: false });
    expect(validateThoughtOutputSchema(missing)).toMatchObject({ ok: false });

    const unknownParsed = parseThoughtSemanticOutput(JSON.stringify(unknown), new Set());
    expect(unknownParsed).toMatchObject({ ok: false, code: "unknown_field" });
    expect(validateThoughtOutputSchema(unknown)).toMatchObject({ ok: false });

    expect(parseThoughtSemanticOutput("{malformed", new Set())).toMatchObject({
      ok: false,
      code: "invalid_json",
    });
  });
});

describe("cloudflare-adapter thought route session affinity", () => {
  const AFFINITY_ID = "qual-synthetic-affinity-01";

  function eligibleDispatch() {
    return {
      messages,
      modelId: DEEPSEEK_MODEL,
      options: { maxTokens: 8192, temperature: 1 },
      fabricReasoning: { kind: "reasoning_effort", value: "high" } as const,
      fabricStructuredOutput: deepseekStructuredOutput,
    };
  }

  function deepseekOkResponse() {
    return fakeResponse({
      id: "cf-deepseek-affinity-1",
      model: DEEPSEEK_MODEL,
      choices: [{ message: { content: '{"kind":"abstain"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, cached_tokens: 0 },
    });
  }

  it("resolves eligibility only for the exact DeepSeek Thought-route bindings", () => {
    env.cloudflareThoughtAffinityId = AFFINITY_ID;
    // All three currently qualified Thought-route bindings are eligible.
    expect(isThoughtRouteAffinityEligible(DEEPSEEK_MODEL, deepseekStructuredOutput)).toBe(true);
    expect(isThoughtRouteAffinityEligible(DEEPSEEK_MODEL, deepseekObservationStructuredOutput)).toBe(true);
    expect(isThoughtRouteAffinityEligible(DEEPSEEK_MODEL, deepseekReflectionStructuredOutput)).toBe(true);
    // Same model, wrong binding facts: not eligible.
    expect(isThoughtRouteAffinityEligible(DEEPSEEK_MODEL, {
      ...deepseekStructuredOutput,
      bindingId: "compat_thought_cloudflare_deepseek_v4_flash_json_object_v9",
    })).toBe(false);
    expect(isThoughtRouteAffinityEligible(DEEPSEEK_MODEL, structuredOutput)).toBe(false);
    expect(isThoughtRouteAffinityEligible(DEEPSEEK_MODEL, undefined)).toBe(false);
    // Allowlisted binding on a different Cloudflare model: not eligible.
    expect(isThoughtRouteAffinityEligible(MODEL, deepseekStructuredOutput)).toBe(false);
    expect(isThoughtRouteAffinityEligible(MODEL, deepseekObservationStructuredOutput)).toBe(false);
    expect(isThoughtRouteAffinityEligible(MODEL, deepseekReflectionStructuredOutput)).toBe(false);
    expect(isThoughtRouteAffinityEligible("mistral-small-2603", deepseekStructuredOutput)).toBe(false);
    // Resolver honors configuration on top of eligibility, per binding.
    for (const control of [
      deepseekStructuredOutput,
      deepseekObservationStructuredOutput,
      deepseekReflectionStructuredOutput,
    ]) {
      expect(resolveThoughtRouteAffinity(DEEPSEEK_MODEL, control)).toMatchObject({
        applied: true,
        transport: {
          sessionAffinityApplied: true,
          affinityPolicy: "cloudflare_thought_route_affinity_v1",
        },
        value: AFFINITY_ID,
      });
    }
    env.cloudflareThoughtAffinityId = "";
    expect(resolveThoughtRouteAffinity(DEEPSEEK_MODEL, deepseekStructuredOutput)).toMatchObject({
      applied: false,
      transport: { sessionAffinityApplied: false, affinityPolicy: "none" },
      value: null,
    });
  });

  it("attaches the affinity header and reports applied truth on the eligible route", async () => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    env.cloudflareThoughtAffinityId = AFFINITY_ID;
    let capturedInit: RequestInit | undefined;
    const adapter = createCloudflareAdapter(async (_url, init) => {
      capturedInit = init;
      return deepseekOkResponse();
    });

    const result = await adapter.dispatch(eligibleDispatch());

    expect((capturedInit?.headers as Record<string, string>)["x-session-affinity"]).toBe(AFFINITY_ID);
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    expect(result.providerBoundaryTransport).toEqual({
      sessionAffinityApplied: true,
      affinityPolicy: "cloudflare_thought_route_affinity_v1",
    });
    expect(result.providerRequestId).toBe("cf-deepseek-affinity-1");
  });

  it.each([
    ["Thought Observation", deepseekObservationStructuredOutput],
    ["Reflection", deepseekReflectionStructuredOutput],
  ])("attaches the same affinity header for the eligible %s binding", async (_label, fabricStructuredOutput) => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    env.cloudflareThoughtAffinityId = AFFINITY_ID;
    let capturedInit: RequestInit | undefined;
    const adapter = createCloudflareAdapter(async (_url, init) => {
      capturedInit = init;
      return deepseekOkResponse();
    });

    const result = await adapter.dispatch({
      messages,
      modelId: DEEPSEEK_MODEL,
      options: { maxTokens: 450, temperature: 1 },
      fabricReasoning: { kind: "reasoning_effort", value: "high" },
      fabricStructuredOutput,
    });

    expect((capturedInit?.headers as Record<string, string>)["x-session-affinity"]).toBe(AFFINITY_ID);
    expect(result.providerBoundaryTransport).toEqual({
      sessionAffinityApplied: true,
      affinityPolicy: "cloudflare_thought_route_affinity_v1",
    });
  });

  it("omits the header and reports absent truth when affinity is not configured", async () => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    env.cloudflareThoughtAffinityId = "";
    let capturedInit: RequestInit | undefined;
    const adapter = createCloudflareAdapter(async (_url, init) => {
      capturedInit = init;
      return deepseekOkResponse();
    });

    const result = await adapter.dispatch(eligibleDispatch());

    expect((capturedInit?.headers as Record<string, string>)["x-session-affinity"]).toBeUndefined();
    expect(result.providerBoundaryTransport).toEqual({
      sessionAffinityApplied: false,
      affinityPolicy: "none",
    });
  });

  it.each([
    ["different model", MODEL, deepseekStructuredOutput],
    ["observation binding on different model", MODEL, deepseekObservationStructuredOutput],
    ["wrong binding", DEEPSEEK_MODEL, { ...deepseekStructuredOutput, bindingId: "compat_other_binding_v1" }],
    ["native binding", DEEPSEEK_MODEL, structuredOutput],
    ["no structured output", DEEPSEEK_MODEL, undefined],
  ])("omits the header for ineligible dispatch: %s", async (_label, modelId, fabricStructuredOutput) => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    env.cloudflareThoughtAffinityId = AFFINITY_ID;
    let capturedInit: RequestInit | undefined;
    const adapter = createCloudflareAdapter(async (_url, init) => {
      capturedInit = init;
      return fakeResponse({
        id: "cf-ineligible-1",
        model: modelId,
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      });
    });

    const result = await adapter.dispatch({
      messages,
      modelId,
      options: { maxTokens: 64 },
      ...(fabricStructuredOutput ? { fabricStructuredOutput } : {}),
    });

    expect((capturedInit?.headers as Record<string, string>)["x-session-affinity"]).toBeUndefined();
    expect(result.providerBoundaryTransport).toEqual({
      sessionAffinityApplied: false,
      affinityPolicy: "none",
    });
  });

  it("keeps the request body byte-identical with affinity on versus off", async () => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    const bodies: string[] = [];
    const digests: Array<string | undefined> = [];
    const headerKeys: string[][] = [];
    for (const affinityId of [AFFINITY_ID, ""]) {
      env.cloudflareThoughtAffinityId = affinityId;
      let capturedInit: RequestInit | undefined;
      const adapter = createCloudflareAdapter(async (_url, init) => {
        capturedInit = init;
        return deepseekOkResponse();
      });
      const result = await adapter.dispatch(eligibleDispatch());
      bodies.push(capturedInit?.body as string);
      digests.push(result.wireEvidence?.sanitizedBodyDigest);
      headerKeys.push(Object.keys((capturedInit?.headers as Record<string, string>) ?? {}).sort());
    }

    expect(bodies[0]).toBe(bodies[1]);
    expect(digests[0]).toBe(digests[1]);
    expect(headerKeys[0]).toEqual([...headerKeys[1], "x-session-affinity"].sort());
  });

  it("preserves applied truth and failure classification on HTTP failure after dispatch", async () => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    env.cloudflareThoughtAffinityId = AFFINITY_ID;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = createCloudflareAdapter(async () =>
      fakeResponse({ error: { message: "busy" } }, { status: 429 }),
    );

    let error: unknown;
    try {
      await adapter.dispatch(eligibleDispatch());
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "rate_limited" });
    expect(providerHttpStatusFromBoundary(error)).toBe(429);
    expect(providerBoundaryTransportFromError(error)).toEqual({
      sessionAffinityApplied: true,
      affinityPolicy: "cloudflare_thought_route_affinity_v1",
    });
  });

  it("preserves applied truth when the provider fetch itself throws", async () => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    env.cloudflareThoughtAffinityId = AFFINITY_ID;
    const adapter = createCloudflareAdapter(async () => {
      throw new TypeError("fetch failed");
    });

    let error: unknown;
    try {
      await adapter.dispatch(eligibleDispatch());
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TypeError);
    expect(providerBoundaryTransportFromError(error)).toEqual({
      sessionAffinityApplied: true,
      affinityPolicy: "cloudflare_thought_route_affinity_v1",
    });
  });

  it("reports absent truth on failure when affinity is not configured", async () => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    env.cloudflareThoughtAffinityId = "";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = createCloudflareAdapter(async () =>
      fakeResponse({ error: { message: "busy" } }, { status: 429 }),
    );

    let error: unknown;
    try {
      await adapter.dispatch(eligibleDispatch());
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "rate_limited" });
    expect(providerBoundaryTransportFromError(error)).toEqual({
      sessionAffinityApplied: false,
      affinityPolicy: "none",
    });
  });

  it("never exposes the raw affinity id outside the outbound header", async () => {
    env.cloudflareApiToken = "test-token";
    env.cloudflareAccountId = "account-test";
    env.cloudflareThoughtAffinityId = AFFINITY_ID;
    let capturedInit: RequestInit | undefined;
    const adapter = createCloudflareAdapter(async (_url, init) => {
      capturedInit = init;
      return deepseekOkResponse();
    });

    const result = await adapter.dispatch(eligibleDispatch());

    expect(capturedInit?.body as string).not.toContain(AFFINITY_ID);
    expect(JSON.stringify(result)).not.toContain(AFFINITY_ID);
    expect(JSON.stringify(messages)).not.toContain(AFFINITY_ID);
  });
});
