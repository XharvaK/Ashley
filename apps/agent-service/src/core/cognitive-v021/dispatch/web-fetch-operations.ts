import { createHash } from "node:crypto";
import { htmlToText } from "../../curiosity/feed.js";
import {
  buildPublicWebFetchRequest,
  isValidWebFetchAudience,
  WEB_FETCH_OPERATION_KIND,
  type WebFetchProvider,
} from "../../perception/web-fetch-provider.js";
import {
  webPageArtifactIdentity,
  type ObservationView,
} from "../observation/view.js";
import type { Observation, ObservationRequest } from "../types.js";
import type { SocialAudience } from "../social/types.js";
import {
  CapabilityUnavailableError,
} from "../thought/typed-inspection.js";

const PAGE_FETCH_PROVENANCE = "perception:web-fetch";
const PAGE_REFRESH_PROVENANCE = "perception:web-fetch-refresh";

type PageText = Readonly<{
  text: string;
  contentHash: string;
  rawByteHash: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function audienceOf(req: ObservationRequest): SocialAudience {
  if (!isValidWebFetchAudience(req.audience)) throw new CapabilityUnavailableError("web_fetch_audience_invalid");
  return req.audience;
}

function textContentType(contentType: string): boolean {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!normalized) return true;
  return normalized.startsWith("text/")
    || normalized === "application/json"
    || normalized === "application/ld+json"
    || normalized === "application/javascript"
    || normalized === "application/xml"
    || normalized === "application/xhtml+xml";
}

function markupContentType(contentType: string): boolean {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized.includes("html") || normalized.includes("xhtml") || normalized.includes("xml");
}

function pageText(resource: Awaited<ReturnType<WebFetchProvider["fetch"]>>): PageText {
  if (!textContentType(resource.contentType)) throw new Error("unsupported_media");
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(resource.body);
  const text = (markupContentType(resource.contentType) ? htmlToText(raw) : raw)
    .replace(/\s+\n/g, "\n")
    .trim();
  return {
    text,
    contentHash: createHash("sha256").update(text).digest("hex"),
    rawByteHash: createHash("sha256").update(resource.body).digest("hex"),
  };
}

function mapWebFetchError(error: unknown): never {
  if (error instanceof CapabilityUnavailableError) throw error;
  const code = error instanceof Error ? error.message : "web_fetch_unavailable";
  switch (code) {
    case "web_fetch_private_input_forbidden":
      throw new CapabilityUnavailableError("web_fetch_private_input_forbidden");
    case "web_fetch_audience_invalid":
      throw new CapabilityUnavailableError("web_fetch_audience_invalid");
    case "web_fetch_request_invalid":
    case "invalid_url":
    case "unsupported_url":
      throw new CapabilityUnavailableError("web_fetch_url_invalid");
    case "non_public_address":
      throw new CapabilityUnavailableError("non_public_address");
    case "response_too_large":
      throw new CapabilityUnavailableError("acquisition_limit");
    case "unsupported_media":
      throw new CapabilityUnavailableError("unsupported_media");
    case "fetch_timeout":
      throw new CapabilityUnavailableError("fetch_timeout");
    case "too_many_redirects":
      throw new CapabilityUnavailableError("too_many_redirects");
    case "redirect_without_location":
      throw new CapabilityUnavailableError("redirect_without_location");
    case "web_fetch_result_invalid":
      throw new CapabilityUnavailableError("web_fetch_result_invalid");
    default:
      throw new CapabilityUnavailableError("web_fetch_unavailable");
  }
}

function validResource(value: unknown): value is Awaited<ReturnType<WebFetchProvider["fetch"]>> {
  if (!isRecord(value)
    || !(value.body instanceof Uint8Array)
    || typeof value.finalUrl !== "string"
    || typeof value.contentType !== "string"
    || typeof value.truncated !== "boolean") {
    return false;
  }
  try {
    const parsed = new URL(value.finalUrl);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.username.length === 0
      && parsed.password.length === 0;
  } catch {
    return false;
  }
}

function pageView(
  identity: Pick<ObservationView, "parentArtifactId" | "representationId">,
  requestedUrl: string,
  resource: Awaited<ReturnType<WebFetchProvider["fetch"]>>,
  capturedAtMs: number,
): ObservationView {
  const partial = resource.truncated === true;
  return {
    ...identity,
    derivation: "page_fetch",
    requestedSelector: { kind: "url", url: requestedUrl },
    returnedSelector: {
      kind: "page",
      finalUrl: resource.finalUrl,
      contentType: resource.contentType,
      capturedAtMs,
    },
    completeness: partial ? "partial" : "complete",
    omission: partial ? { reason: "acquisition_limit" } : null,
    continuation: null,
    errors: [],
    contentHashBasis: "cleaned_utf8",
    inputTrust: "untrusted_evidence",
  };
}

function pageObservation(input: {
  req: ObservationRequest;
  requestedUrl: string;
  resource: Awaited<ReturnType<WebFetchProvider["fetch"]>>;
  cleaned: PageText;
  capturedAtMs: number;
  operationKind: string;
  previousArtifactId?: string;
  previousContentHash?: string;
}): Observation {
  const identity = webPageArtifactIdentity({
    requestedUrl: input.requestedUrl,
    contentHash: input.cleaned.contentHash,
    capturedAtMs: input.capturedAtMs,
  });
  const view = pageView(identity, input.requestedUrl, input.resource, input.capturedAtMs);
  return {
    observationId: `v021:observation:${input.req.requestId}`,
    cycleId: input.req.cycleId,
    generation: input.req.generation,
    derived: false,
    replaySafe: true,
    modality: "page",
    payload: {
      operationKind: input.operationKind,
      ...(input.operationKind === "evidence.refresh" ? { unchanged: false } : {}),
      requestedUrl: input.requestedUrl,
      finalUrl: input.resource.finalUrl,
      contentType: input.resource.contentType,
      capturedAtMs: input.capturedAtMs,
      contentHash: input.cleaned.contentHash,
      sha256: input.cleaned.contentHash,
      rawByteHash: input.cleaned.rawByteHash,
      rawByteSize: input.resource.body.byteLength,
      representation: "utf8_text",
      contentUtf8: input.cleaned.text,
      truncated: input.resource.truncated,
      artifactId: identity.parentArtifactId,
      representationId: identity.representationId,
      ...(input.previousArtifactId === undefined ? {} : {
        previousArtifactId: input.previousArtifactId,
        previousContentHash: input.previousContentHash,
      }),
    },
    provenance: PAGE_FETCH_PROVENANCE,
    dataClassification: "ordinary",
    secretOmitted: false,
    view,
  };
}

function unchangedPageRefreshObservation(input: {
  req: ObservationRequest;
  requestedUrl: string;
  resource: Awaited<ReturnType<WebFetchProvider["fetch"]>>;
  artifactId: string;
  representationId: string;
  contentHash: string;
  checkedAtMs: number;
}): Observation {
  const view: ObservationView = {
    parentArtifactId: input.artifactId,
    representationId: input.representationId,
    derivation: "page_fetch",
    requestedSelector: { kind: "url", url: input.requestedUrl },
    returnedSelector: {
      kind: "refresh_check",
      finalUrl: input.resource.finalUrl,
      contentType: input.resource.contentType,
      checkedAtMs: input.checkedAtMs,
    },
    completeness: input.resource.truncated ? "partial" : "complete",
    omission: input.resource.truncated ? { reason: "acquisition_limit" } : null,
    continuation: null,
    errors: [],
    contentHashBasis: "cleaned_utf8",
    inputTrust: "untrusted_evidence",
  };
  return {
    observationId: `v021:observation:${input.req.requestId}`,
    cycleId: input.req.cycleId,
    generation: input.req.generation,
    derived: false,
    replaySafe: true,
    modality: "page",
    payload: {
      operationKind: "evidence.refresh",
      unchanged: true,
      checkedAtMs: input.checkedAtMs,
      validator: "sha256",
      requestedUrl: input.requestedUrl,
      finalUrl: input.resource.finalUrl,
      artifactId: input.artifactId,
      representationId: input.representationId,
      contentHash: input.contentHash,
    },
    provenance: PAGE_REFRESH_PROVENANCE,
    dataClassification: "ordinary",
    secretOmitted: false,
    view,
  };
}

export async function executeWebFetchOperation(input: {
  req: ObservationRequest;
  provider: WebFetchProvider;
  nowMs?: () => number;
}): Promise<Observation> {
  let request;
  try {
    request = buildPublicWebFetchRequest(input.req.request, audienceOf(input.req));
  } catch (error) {
    return mapWebFetchError(error);
  }
  if (input.provider.available !== true) {
    throw new CapabilityUnavailableError("web_fetch_unavailable");
  }
  let resource: Awaited<ReturnType<WebFetchProvider["fetch"]>>;
  try {
    resource = await input.provider.fetch(request.url);
  } catch (error) {
    return mapWebFetchError(error);
  }
  if (!validResource(resource)) return mapWebFetchError(new Error("web_fetch_result_invalid"));
  try {
    return pageObservation({
      req: input.req,
      requestedUrl: request.url,
      resource,
      cleaned: pageText(resource),
      capturedAtMs: input.nowMs?.() ?? Date.now(),
      operationKind: WEB_FETCH_OPERATION_KIND,
    });
  } catch (error) {
    return mapWebFetchError(error);
  }
}

export async function executeWebPageRefresh(input: {
  req: ObservationRequest;
  provider: WebFetchProvider;
  sourceUrl: string;
  artifactId: string;
  representationId: string;
  previousContentHash: string;
  nowMs: () => number;
}): Promise<Observation> {
  let request;
  try {
    request = buildPublicWebFetchRequest({ url: input.sourceUrl }, audienceOf(input.req));
  } catch (error) {
    return mapWebFetchError(error);
  }
  if (!/^[a-f0-9]{64}$/.test(input.previousContentHash)) {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  if (input.provider.available !== true) {
    throw new CapabilityUnavailableError("web_fetch_unavailable");
  }
  let resource: Awaited<ReturnType<WebFetchProvider["fetch"]>>;
  try {
    resource = await input.provider.fetch(request.url);
  } catch (error) {
    return mapWebFetchError(error);
  }
  if (!validResource(resource)) return mapWebFetchError(new Error("web_fetch_result_invalid"));
  try {
    const cleaned = pageText(resource);
    const checkedAtMs = input.nowMs();
    if (cleaned.contentHash === input.previousContentHash && resource.truncated !== true) {
      return unchangedPageRefreshObservation({
        req: input.req,
        requestedUrl: request.url,
        resource,
        artifactId: input.artifactId,
        representationId: input.representationId,
        contentHash: cleaned.contentHash,
        checkedAtMs,
      });
    }
    return pageObservation({
      req: input.req,
      requestedUrl: request.url,
      resource,
      cleaned,
      capturedAtMs: checkedAtMs,
      operationKind: "evidence.refresh",
      previousArtifactId: input.artifactId,
      previousContentHash: input.previousContentHash,
    });
  } catch (error) {
    return mapWebFetchError(error);
  }
}
