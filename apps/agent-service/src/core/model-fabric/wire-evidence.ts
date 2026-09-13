import { sha256 } from "./hash.js";
import type { TrustedStructuredOutputControl } from "./types.js";
import type { WireDispatchEvidence } from "../model-routing/types.js";

/**
 * Hash only sanitized request structure. Provider keys and user/model content
 * are never copied into W1 wire evidence.
 */
export function wireEvidenceFor(input: {
  adapterId: string;
  body: Record<string, unknown>;
  structuredOutput?: TrustedStructuredOutputControl;
}): WireDispatchEvidence {
  const body = { ...input.body };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  delete body.messages;
  const sanitizedBody = {
    ...body,
    messageCount: messages.length,
  };
  const structured = input.structuredOutput;
  const wireFormat = structured
    ? structured.kind === "native_json_schema"
      ? structured.wireFormat
      : "json_object"
    : typeof body.response_format === "object"
      ? "json_object"
      : "provider_default";
  const emittedEnforcementMode = structured
    ? structured.kind === "native_json_schema"
      ? structured.wireFormat === "nim_guided_json"
        ? "guided_json"
        : "native_json_schema"
      : "json_object_compatibility"
    : "none";
  return Object.freeze({
    adapterId: input.adapterId,
    wireFormat,
    sanitizedBodyDigest: `sha256:${sha256(sanitizedBody)}`,
    emittedEnforcementMode,
    providerDeclaredEnforcement: "unavailable",
    bindingId: structured?.bindingId ?? null,
  });
}
