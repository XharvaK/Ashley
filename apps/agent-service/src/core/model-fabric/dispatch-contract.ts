import type {
  CurrentPolicyResolution,
  ModelFabricOccupant,
} from "./portfolio.js";
import type {
  StructuredOutputRequest,
  StructuredOutputSchemaFingerprint,
  TrustedStructuredOutputControl,
} from "./types.js";
import { sha256 } from "./hash.js";
import { capabilityProfileFor } from "./profiles.js";

export const THOUGHT_OUTPUT_CONTRACT_ID = "ashley.thought.semantic.v2";
export const THOUGHT_OUTPUT_SCHEMA_ID = "ashley.thought.semantic.v2.schema";

export type ResolvedDispatchContract = Readonly<{
  maxTokens: number;
  responseFormat: "json_object" | "json_schema" | undefined;
  structuredOutput: TrustedStructuredOutputControl | null;
  structuredOutputContractId: string | null;
  structuredOutputMode: "json_object_compatibility" | "native_json_schema" | null;
  structuredOutputBindingId: string | null;
  structuredOutputSchemaFingerprint: StructuredOutputSchemaFingerprint | null;
}>;

export type DispatchContractErrorCode =
  | "model_fabric_output_budget_missing"
  | "model_fabric_output_budget_invalid"
  | "model_fabric_output_budget_exceeded"
  | "model_fabric_structured_output_missing"
  | "model_fabric_structured_output_mismatch"
  | "model_fabric_structured_output_binding_invalid"
  | "model_fabric_capability_output_budget_exceeded";

export class ModelFabricDispatchContractError extends Error {
  readonly code: DispatchContractErrorCode;

  constructor(code: DispatchContractErrorCode) {
    super(code);
    this.name = "ModelFabricDispatchContractError";
    this.code = code;
  }
}

function occupantFor(
  policy: CurrentPolicyResolution,
  provider: string,
  configuredModelId: string,
): ModelFabricOccupant | null {
  return policy.policyRow.occupants.find(
    (occupant) =>
      occupant.provider === provider &&
      occupant.configuredModelId === configuredModelId,
  ) ?? null;
}

function compatibilityBindingId(provider: string, configuredModelId: string): string {
  return `unverified-compatibility:${provider}:${configuredModelId}`;
}

function structuredControlFor(input: {
  policy: CurrentPolicyResolution;
  provider: string;
  configuredModelId: string;
  request: StructuredOutputRequest;
}): {
  control: TrustedStructuredOutputControl;
  mode: ResolvedDispatchContract["structuredOutputMode"];
  bindingId: string;
} {
  const occupant = occupantFor(
    input.policy,
    input.provider,
    input.configuredModelId,
  );
  const binding = occupant?.structuredOutputBinding;
  if (binding) {
    if (!binding.bindingId) {
      throw new ModelFabricDispatchContractError(
        "model_fabric_structured_output_binding_invalid",
      );
    }
    if (binding.mode === "native_json_schema") {
      if (
        binding.wireFormat !== "nim_guided_json" &&
        binding.wireFormat !== "nim_response_format_json_schema" &&
        binding.wireFormat !== "mistral_response_format_json_schema" &&
        binding.wireFormat !== "cloudflare_response_format_json_schema"
      ) {
        throw new ModelFabricDispatchContractError(
          "model_fabric_structured_output_binding_invalid",
        );
      }
      return {
        control: {
          kind: "native_json_schema",
          contractId: input.request.contractId,
          schemaId: input.request.schemaId,
          schemaFingerprint: input.request.schemaFingerprint,
          bindingId: binding.bindingId,
          wireFormat: binding.wireFormat,
          schema: input.request.schema,
        },
        mode: "native_json_schema",
        bindingId: binding.bindingId,
      };
    }
    if (binding.mode !== "json_object_compatibility") {
      throw new ModelFabricDispatchContractError(
        "model_fabric_structured_output_binding_invalid",
      );
    }
    return {
      control: {
        kind: "json_object_compatibility",
        contractId: input.request.contractId,
        schemaId: input.request.schemaId,
        schemaFingerprint: input.request.schemaFingerprint,
        bindingId: binding.bindingId,
      },
      mode: "json_object_compatibility",
      bindingId: binding.bindingId,
    };
  }

  const bindingId = compatibilityBindingId(input.provider, input.configuredModelId);
  return {
    control: {
      kind: "json_object_compatibility",
      contractId: input.request.contractId,
      schemaId: input.request.schemaId,
      schemaFingerprint: input.request.schemaFingerprint,
      bindingId,
    },
    mode: "json_object_compatibility",
    bindingId,
  };
}

/**
 * Resolves the one output budget and structured-output wire contract before
 * attention admission. Caller ceilings can narrow policy, never widen it.
 */
export function resolveDispatchContract(input: {
  policy: CurrentPolicyResolution;
  provider: string;
  configuredModelId: string;
  requestedMaxTokens?: number;
  responseFormat?: "json_object" | "json_schema";
  structuredOutput?: StructuredOutputRequest;
}): ResolvedDispatchContract {
  const policyMax = input.policy.policyRow.maxOutputTokens;
  if (
    policyMax == null ||
    !Number.isInteger(policyMax) ||
    policyMax < 1
  ) {
    throw new ModelFabricDispatchContractError(
      "model_fabric_output_budget_missing",
    );
  }

  const capabilityMax = capabilityProfileFor(
    input.provider,
    input.configuredModelId,
  ).limits.maxOutputTokens;
  if (policyMax > capabilityMax) {
    throw new ModelFabricDispatchContractError(
      "model_fabric_capability_output_budget_exceeded",
    );
  }

  let maxTokens = policyMax;
  if (input.requestedMaxTokens !== undefined) {
    if (!Number.isInteger(input.requestedMaxTokens) || input.requestedMaxTokens < 1) {
      throw new ModelFabricDispatchContractError(
        "model_fabric_output_budget_invalid",
      );
    }
    if (input.requestedMaxTokens > policyMax) {
      throw new ModelFabricDispatchContractError(
        "model_fabric_output_budget_exceeded",
      );
    }
    maxTokens = input.requestedMaxTokens;
  }

  if (input.responseFormat === "json_schema" && !input.structuredOutput) {
    throw new ModelFabricDispatchContractError(
      "model_fabric_structured_output_missing",
    );
  }
  if (input.structuredOutput) {
    if (
      input.responseFormat !== "json_schema" ||
      input.policy.policyRow.structuredOutput !== "json_schema" ||
      input.structuredOutput.contractId !== THOUGHT_OUTPUT_CONTRACT_ID ||
      input.structuredOutput.schemaId !== THOUGHT_OUTPUT_SCHEMA_ID ||
      !input.structuredOutput.schema ||
      typeof input.structuredOutput.schema !== "object" ||
      Array.isArray(input.structuredOutput.schema) ||
      !/^sha256:[0-9a-f]{64}$/.test(input.structuredOutput.schemaFingerprint) ||
      input.structuredOutput.schemaFingerprint !==
        (`sha256:${sha256(input.structuredOutput.schema)}` as StructuredOutputSchemaFingerprint)
    ) {
      throw new ModelFabricDispatchContractError(
        "model_fabric_structured_output_mismatch",
      );
    }
    const structured = structuredControlFor({
      policy: input.policy,
      provider: input.provider,
      configuredModelId: input.configuredModelId,
      request: input.structuredOutput,
    });
    return {
      maxTokens,
      responseFormat:
        structured.mode === "native_json_schema" ? "json_schema" : "json_object",
      structuredOutput: structured.control,
      structuredOutputContractId: input.structuredOutput.contractId,
      structuredOutputMode: structured.mode,
      structuredOutputBindingId: structured.bindingId,
      structuredOutputSchemaFingerprint: input.structuredOutput.schemaFingerprint,
    };
  }

  return {
    maxTokens,
    responseFormat: input.responseFormat,
    structuredOutput: null,
    structuredOutputContractId: null,
    structuredOutputMode: null,
    structuredOutputBindingId: null,
    structuredOutputSchemaFingerprint: null,
  };
}

export function resolveAttemptDispatchContract(
  targetProvider: import("../model-routing/types.js").ProviderId,
  targetModel: string,
  input: {
    policy: CurrentPolicyResolution;
    maxTokens?: number;
    responseFormat?: "json_object" | "json_schema";
    structuredOutput?: StructuredOutputRequest | null;
  },
): ResolvedDispatchContract {
  return resolveDispatchContract({
    policy: input.policy,
    provider: targetProvider,
    configuredModelId: targetModel,
    requestedMaxTokens: input.maxTokens,
    responseFormat: input.responseFormat,
    structuredOutput: input.structuredOutput ?? undefined,
  });
}
