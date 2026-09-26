import { sha256 } from "../../model-fabric/hash.js";
import {
  buildPublicWebSearchQuery,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_OPERATION_KIND,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchResultSet,
} from "../../perception/search-provider.js";
import {
  CapabilityUnavailableError,
} from "../thought/typed-inspection.js";
import type { Observation, ObservationRequest } from "../types.js";
import type { ObservationView } from "../observation/view.js";
import type { SocialAudience } from "../social/types.js";

const WEB_SEARCH_MAX_PROVIDER_NAME_CHARS = 128;
const WEB_SEARCH_MAX_RESULT_SET_ID_CHARS = 256;
const WEB_SEARCH_MAX_TITLE_CHARS = 1_024;
const WEB_SEARCH_MAX_URL_CHARS = 2_048;
const WEB_SEARCH_MAX_SNIPPET_CHARS = 8_192;

type ValidatedWebSearchResultSet = Readonly<{
  query: string;
  results: readonly WebSearchResult[];
  providerName: string;
  capturedAtMs: number;
  resultSetId: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxChars: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxChars;
}

function validHttpUrl(value: unknown): value is string {
  if (!boundedText(value, WEB_SEARCH_MAX_URL_CHARS)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validResult(value: unknown): value is WebSearchResult {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !["title", "url", "snippet"].includes(key))) {
    return false;
  }
  return boundedText(value.title, WEB_SEARCH_MAX_TITLE_CHARS)
    && validHttpUrl(value.url)
    && boundedText(value.snippet, WEB_SEARCH_MAX_SNIPPET_CHARS);
}

function validateResultSet(
  query: WebSearchRequest,
  value: unknown,
): ValidatedWebSearchResultSet {
  if (!isRecord(value)
    || value.query !== query.query
    || !boundedText(value.providerName, WEB_SEARCH_MAX_PROVIDER_NAME_CHARS)
    || !boundedText(value.resultSetId, WEB_SEARCH_MAX_RESULT_SET_ID_CHARS)
    || typeof value.capturedAtMs !== "number"
    || !Number.isSafeInteger(value.capturedAtMs)
    || value.capturedAtMs < 0
    || !Array.isArray(value.results)
    || value.results.length > WEB_SEARCH_MAX_RESULTS
    || (query.maxResults !== undefined && value.results.length > query.maxResults)
    || !value.results.every(validResult)) {
    throw new Error("web_search_result_invalid");
  }
  return {
    query: value.query,
    results: value.results,
    providerName: value.providerName,
    capturedAtMs: value.capturedAtMs,
    resultSetId: value.resultSetId,
  };
}

export function webSearchResultSetArtifactIdentity(
  resultSet: WebSearchResultSet,
): Readonly<{ parentArtifactId: string; representationId: string }> {
  const parentArtifactId = `artifact:v1:${sha256({
    sourceLocator: {
      kind: "web_search_result_set",
      providerName: resultSet.providerName,
      resultSetId: resultSet.resultSetId,
    },
    query: resultSet.query,
    capturedAtMs: resultSet.capturedAtMs,
    results: resultSet.results,
  })}`;
  return {
    parentArtifactId,
    representationId: `representation:v1:${sha256({
      parentArtifactId,
      kind: "web_search_result_set",
    })}`,
  };
}

function resultSetView(
  identity: Readonly<{ parentArtifactId: string; representationId: string }>,
  resultSetId: string,
  resultCount: number,
): ObservationView {
  return {
    ...identity,
    derivation: "search_snippet",
    requestedSelector: { kind: "search_result_set", resultSetId },
    returnedSelector: { kind: "search_result_set", resultSetId, resultCount },
    completeness: "complete",
    omission: null,
    continuation: null,
    errors: [],
    contentHashBasis: "provider_result_set",
    inputTrust: "untrusted_evidence",
  };
}

function resultView(
  identity: Readonly<{ parentArtifactId: string; representationId: string }>,
  resultSetId: string,
  index: number,
): ObservationView {
  return {
    ...identity,
    derivation: "search_snippet",
    requestedSelector: { kind: "search_result", resultSetId, index },
    returnedSelector: { kind: "search_result", resultSetId, index },
    completeness: "complete",
    omission: null,
    continuation: null,
    errors: [],
    contentHashBasis: "provider_result_set",
    inputTrust: "untrusted_evidence",
  };
}

function mapWebSearchError(error: unknown): never {
  if (error instanceof CapabilityUnavailableError) throw error;
  const code = error instanceof Error ? error.message : "";
  if (code === "web_search_private_input_forbidden") {
    throw new CapabilityUnavailableError("web_search_egress_rejected");
  }
  if (code === "web_search_request_invalid") {
    throw new CapabilityUnavailableError("web_search_request_invalid");
  }
  if (code === "web_search_audience_invalid") {
    throw new CapabilityUnavailableError("web_search_audience_invalid");
  }
  if (code === "web_search_result_invalid") {
    throw new CapabilityUnavailableError("web_search_result_invalid");
  }
  throw new CapabilityUnavailableError("web_search_unavailable");
}

export async function executeWebSearchOperation(input: {
  req: ObservationRequest;
  provider: WebSearchProvider;
}): Promise<Observation> {
  let query: WebSearchRequest;
  try {
    query = buildPublicWebSearchQuery(input.req.request, input.req.audience as SocialAudience);
  } catch (error) {
    return mapWebSearchError(error);
  }
  if (input.provider.available !== true) {
    throw new CapabilityUnavailableError("web_search_unavailable");
  }

  let resultSet: WebSearchResultSet;
  try {
    resultSet = await input.provider.search(
      query.query,
      query.maxResults === undefined ? undefined : { maxResults: query.maxResults },
    );
  } catch (error) {
    return mapWebSearchError(error);
  }

  try {
    const validated = validateResultSet(query, resultSet);
    const identity = webSearchResultSetArtifactIdentity(validated);
    const topLevelView = resultSetView(identity, validated.resultSetId, validated.results.length);
    return {
      observationId: `v021:observation:${input.req.requestId}`,
      cycleId: input.req.cycleId,
      generation: input.req.generation,
      derived: false,
      replaySafe: true,
      modality: "text",
      payload: {
        operationKind: WEB_SEARCH_OPERATION_KIND,
        query: validated.query,
        providerName: validated.providerName,
        capturedAtMs: validated.capturedAtMs,
        resultSetId: validated.resultSetId,
        resultSetArtifact: {
          artifactId: identity.parentArtifactId,
          representationId: identity.representationId,
        },
        results: validated.results.map((result, index) => ({
          ...result,
          view: resultView(identity, validated.resultSetId, index),
        })),
      },
      provenance: "perception:web-search",
      dataClassification: "ordinary",
      secretOmitted: false,
      view: topLevelView,
    };
  } catch (error) {
    return mapWebSearchError(error);
  }
}
