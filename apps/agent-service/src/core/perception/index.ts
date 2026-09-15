import type { DatabaseSync } from "node:sqlite";
import { fetchAttachmentBytes } from "./fetch.js";
import {
  readArtifactBytes,
  readArtifactTextPage,
  storeArtifactBytes,
} from "./artifact-store.js";
import {
  authorizeConversationalRead,
  createPendingRead,
  fetchConversationalReadPage,
  markConversationalReadIncluded,
} from "./conversational-read.js";
import {
  buildInlineDataUri,
  createPendingArtifacts,
  isImageMime,
  isTextMime,
  markArtifactIncluded,
  markPdfUnsupported,
  transitionArtifactStatus,
  urlFingerprint,
  type PendingArtifactRecord,
} from "./ingest.js";
import {
  checkAttachmentPreflight,
  conversationalReadPreflight,
} from "./preflight.js";
import { perceptionCapabilityCanInfluence } from "./capability-self-model.js";
import { classifyResearchIntent } from "./research-intent.js";
import {
  MAX_MODEL_EXCERPT_CHARS,
  MAX_SINGLE_ATTACHMENT_BYTES,
  type AttachmentIntakeRef,
  type ModelPartRecord,
  type PerceptionInlinePart,
  type PerceptionLicenses,
  type PerceptionTurnInput,
  type PerceptionTurnResult,
} from "./types.js";
import type { SocialAudience } from "../cognitive-v021/social/types.js";

export type { PerceptionTurnInput, PerceptionTurnResult } from "./types.js";
export { fetchAttachmentBytes } from "./fetch.js";
export {
  artifactByteStoreDir,
  readArtifactBytes,
  readArtifactTextPage,
  storeArtifactBytes,
  sweepExpiredArtifacts,
  type ArtifactTextPage,
  type ArtifactSweepResult,
  type IntegrityProof,
} from "./artifact-store.js";
export {
  createPendingArtifacts,
  transitionArtifactStatus,
  markArtifactIncluded,
  buildInlineDataUri,
} from "./ingest.js";
export { checkAttachmentPreflight } from "./preflight.js";
export { composeSelfCapabilityContext } from "./capability-self-model.js";
export { classifyResearchIntent } from "./research-intent.js";
export {
  createPendingRead,
  authorizeConversationalRead,
  fetchConversationalReadPage,
} from "./conversational-read.js";
export {
  defaultWebSearchProvider,
  type WebSearchProvider,
} from "./search-provider.js";
export {
  listPerceptionForgetTargets,
  redactPerceptionTargets,
  redactPerceptionByOwnerTopic,
} from "./forget.js";

function emptyLicenses(): PerceptionLicenses {
  return {
    imageIncluded: [],
    textExcerptIncluded: [],
    conversationalReadIncluded: [],
  };
}

function aggregateDeclaredBytes(attachments: AttachmentIntakeRef[]): number {
  return attachments.reduce(
    (total, attachment) =>
      total + Math.max(0, attachment.declaredByteSize ?? 0),
    0,
  );
}

function textExcerptFromBytes(
  bytes: Uint8Array,
  maxChars: number,
): { text: string; completeness: "complete" | "truncated_at_limit" } {
  const decoded = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes)
    .replace(/\s+/g, " ")
    .trim();
  return {
    text: decoded.slice(0, maxChars),
    completeness: decoded.length > maxChars ? "truncated_at_limit" : "complete",
  };
}

function bindAudience<T extends PerceptionInlinePart>(
  part: T,
  audience: SocialAudience,
): T {
  // Preserve the byte-for-byte Owner projection while making every external
  // perception part carry its requesting lifecycle audience.
  return audience.kind === "owner_private"
    ? part
    : { ...part, audienceScope: audience };
}

async function processArtifactFetch(
  db: DatabaseSync,
  ownerId: string,
  artifact: PendingArtifactRecord,
  options: {
    timeoutMs: number;
    visionAllowed: boolean;
    attachmentTextAllowed: boolean;
    thoughtParts: PerceptionInlinePart[];
    expressionParts: PerceptionInlinePart[];
    licenses: PerceptionLicenses;
    audience: SocialAudience;
  },
): Promise<void> {
  const row = db
    .prepare(
      `SELECT status FROM perception_artifacts
       WHERE entity_uuid = ? AND owner_id = ?`,
    )
    .get(artifact.entityUuid, ownerId) as { status?: string } | undefined;
  if (row?.status === "unsupported" || row?.status === "failed") return;

  transitionArtifactStatus(db, artifact.entityUuid, ownerId, "fetching");
  try {
    const fetched = await fetchAttachmentBytes(artifact.sourceUrl, {
      timeoutMs: options.timeoutMs,
      maxBytes: MAX_SINGLE_ATTACHMENT_BYTES,
    });
    if (fetched.mime === "application/pdf") {
      markPdfUnsupported(db, artifact.entityUuid, ownerId);
      return;
    }
    transitionArtifactStatus(db, artifact.entityUuid, ownerId, "fetched", {
      mimeDetected: fetched.mime,
      finalUrlFingerprint: urlFingerprint(fetched.finalUrl),
      contentHash: fetched.contentHash,
      byteSize: fetched.bytes.byteLength,
    });

    const preserveArtifact = isImageMime(fetched.mime) || isTextMime(fetched.mime);
    if (preserveArtifact) {
      // The store verifies and writes the complete bytes before its final
      // preserved=1 update. Projection below reads back those same bytes.
      storeArtifactBytes(db, ownerId, artifact.entityUuid, fetched.bytes, fetched.mime);
    }

    const modelParts: ModelPartRecord[] = [];
    if (isImageMime(fetched.mime) && options.visionAllowed) {
      const preservedBytes = readArtifactBytes(db, artifact.entityUuid, ownerId);
      const dataUri = buildInlineDataUri(preservedBytes, fetched.mime);
      modelParts.push({ audience: "thought", partIndex: 0 });
      modelParts.push({ audience: "expression", partIndex: 0 });
      markArtifactIncluded(db, artifact.entityUuid, ownerId, modelParts, {
        modelRepresentation: "inline_base64",
      });
      const part: PerceptionInlinePart = bindAudience({
        audience: "thought",
        kind: "image",
        entityUuid: artifact.entityUuid,
        artifactRef: artifact.entityUuid,
        content: dataUri,
        mime: fetched.mime,
        completeness: "complete",
        furtherRetrievalAvailable: false,
      }, options.audience);
      options.thoughtParts.push(part);
      options.expressionParts.push(bindAudience({ ...part, audience: "expression" }, options.audience));
      options.licenses.imageIncluded.push(artifact.entityUuid);
      return;
    }

    if (isTextMime(fetched.mime) && options.attachmentTextAllowed) {
      const preservedBytes = readArtifactBytes(db, artifact.entityUuid, ownerId);
      const projection = textExcerptFromBytes(preservedBytes, MAX_MODEL_EXCERPT_CHARS);
      if (!projection.text) {
        transitionArtifactStatus(db, artifact.entityUuid, ownerId, "failed", {
          errorCode: "empty_text_attachment",
        });
        return;
      }
      modelParts.push({ audience: "thought", partIndex: 0 });
      markArtifactIncluded(db, artifact.entityUuid, ownerId, modelParts, {
        modelRepresentation: "inline_text_excerpt",
        excerpt: projection.text.slice(0, 2_000),
      });
      options.thoughtParts.push(bindAudience({
        audience: "thought",
        kind: "text_excerpt",
        entityUuid: artifact.entityUuid,
        artifactRef: artifact.entityUuid,
        content: projection.text,
        mime: fetched.mime,
        completeness: projection.completeness,
        furtherRetrievalAvailable: projection.completeness === "truncated_at_limit",
      }, options.audience));
      options.licenses.textExcerptIncluded.push(artifact.entityUuid);
      return;
    }

    transitionArtifactStatus(db, artifact.entityUuid, ownerId, "unsupported", {
      errorCode: "unsupported_mime",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "fetch_failed";
    if (code === "response_too_large") {
      transitionArtifactStatus(db, artifact.entityUuid, ownerId, "unsupported", {
        errorCode: "too-large",
      });
    } else {
      transitionArtifactStatus(db, artifact.entityUuid, ownerId, "failed", {
        errorCode: code.slice(0, 120),
      });
    }
  }
}

export function fetchArtifactTextPage(
  db: DatabaseSync,
  params: {
    entityUuid: string;
    ownerId: string;
    offsetChars: number;
    limitChars: number;
  },
) {
  return readArtifactTextPage(
    db,
    params.entityUuid,
    params.offsetChars,
    params.limitChars,
    params.ownerId,
  );
}

export async function runPerceptionTurn(
  db: DatabaseSync,
  input: PerceptionTurnInput,
): Promise<PerceptionTurnResult> {
  const audience = input.audience ?? { kind: "owner_private" };
  const researchIntent = classifyResearchIntent(input.message);
  const licenses = emptyLicenses();
  const thoughtParts: PerceptionInlinePart[] = [];
  const expressionParts: PerceptionInlinePart[] = [];
  if (Date.now() >= input.deadlineAtMs) {
    return {
      artifactsCreated: 0,
      conversationalReadCreated: false,
      preflightBlocked: true,
      preflightReason: "perception_budget_unavailable",
      thoughtParts,
      expressionParts,
      licenses,
      researchIntent,
    };
  }
  const aggregateBytes = aggregateDeclaredBytes(input.attachments);

  const artifacts =
    input.attachments.length > 0
      ? createPendingArtifacts(db, {
          ownerId: input.ownerId,
          attachments: input.attachments,
          sourceMessageEntityUuid: input.sourceMessageEntityUuid,
          deliveryReservationEntityUuid: input.deliveryReservationEntityUuid,
          aggregateTurnBytes: aggregateBytes,
        })
      : [];

  let conversationalReadCreated = false;
  let conversationalRead:
    | {
        entityUuid: string;
        requestedUrl: string;
      }
    | null = null;

  if (researchIntent.intent) {
    const pending = createPendingRead(db, {
      ownerId: input.ownerId,
      url: researchIntent.url,
      sourceMessageEntityUuid: input.sourceMessageEntityUuid,
      deliveryReservationEntityUuid: input.deliveryReservationEntityUuid,
    });
    if (pending) {
      conversationalReadCreated = true;
      conversationalRead = {
        entityUuid: pending.entityUuid,
        requestedUrl: pending.requestedUrl,
      };
      authorizeConversationalRead(
        db,
        pending.entityUuid,
        input.ownerId,
        input.decision,
      );
    }
  }

  if (artifacts.length === 0 && !conversationalRead) {
    return {
      artifactsCreated: 0,
      conversationalReadCreated,
      preflightBlocked: false,
      thoughtParts,
      expressionParts,
      licenses,
      researchIntent,
    };
  }

  const preflight = checkAttachmentPreflight(
    db,
    input.ownerId,
    input.deadlineAtMs,
    aggregateBytes,
  );

  if (artifacts.length > 0 && preflight.allowed) {
    await Promise.all(
      artifacts.map((artifact) =>
        processArtifactFetch(db, input.ownerId, artifact, {
          timeoutMs: preflight.fetchBudgetMs,
          visionAllowed: preflight.visionAllowed,
          attachmentTextAllowed: preflight.attachmentTextAllowed,
          thoughtParts,
          expressionParts,
          licenses,
          audience,
        }),
      ),
    );
  } else if (artifacts.length > 0) {
    for (const artifact of artifacts) {
      transitionArtifactStatus(db, artifact.entityUuid, input.ownerId, "failed", {
        errorCode: preflight.reasonCode ?? "preflight_blocked",
      });
    }
  }

  if (
    conversationalRead &&
    researchIntent.intent &&
    perceptionCapabilityCanInfluence(db, "conversational_read")
  ) {
    const readPreflight = conversationalReadPreflight(
      db,
      input.deadlineAtMs,
    );
    if (
      readPreflight.allowed &&
      input.decision.kind !== "refuse" &&
      input.decision.kind !== "silence"
    ) {
      const page = await fetchConversationalReadPage(db, {
        ownerId: input.ownerId,
        entityUuid: conversationalRead.entityUuid,
        url: conversationalRead.requestedUrl,
        timeoutMs: readPreflight.fetchBudgetMs,
      });
      if (page) {
        const modelParts: ModelPartRecord[] = [
          { audience: "thought", partIndex: 0 },
        ];
        markConversationalReadIncluded(
          db,
          conversationalRead.entityUuid,
          input.ownerId,
          modelParts,
        );
        const excerptPart = bindAudience<PerceptionInlinePart>({
          audience: "thought",
          kind: "conversational_read",
          entityUuid: conversationalRead.entityUuid,
          artifactRef: conversationalRead.entityUuid,
          content: `Title: ${page.title}\n\n${page.modelExcerpt}`,
          completeness: page.modelExcerpt.length >= MAX_MODEL_EXCERPT_CHARS
            ? "truncated_at_limit"
            : "complete",
          furtherRetrievalAvailable: page.modelExcerpt.length >= MAX_MODEL_EXCERPT_CHARS,
        }, audience);
        thoughtParts.push(excerptPart);
        licenses.conversationalReadIncluded.push(conversationalRead.entityUuid);
      }
    }
  }

  return {
    artifactsCreated: artifacts.length,
    conversationalReadCreated,
    preflightBlocked: artifacts.length > 0 && !preflight.allowed,
    preflightReason: preflight.allowed ? undefined : preflight.reasonCode,
    thoughtParts,
    expressionParts,
    licenses,
    researchIntent,
  };
}
