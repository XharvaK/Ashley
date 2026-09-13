import type { DispatchTruth, ModelFailure } from "../../model-fabric/types.js";
import type { ProviderResponseDiagnostics } from "../../model-routing/types.js";

export type ThoughtQualificationCaseId =
  | "settlement"
  | "observation_intent"
  | "effect_intent"
  | "abstain"
  | "structural_correction"
  | "stale_before_publish"
  | "authority_revision";

export type ThoughtQualificationEnvironment = "fixture" | "isolated_live";
export type QualificationGateStatus = "PASS" | "FAIL" | "NOT_REACHED";

export type QualificationSemanticDiagnosticViolation = Readonly<{
  code: string;
  path: string;
  expected: string;
  actual: string;
}>;

/** Qualification-only evidence; this is not an alternate production parser. */
export type QualificationSemanticDiagnostic = Readonly<{
  staticSchema: "PASS" | "FAIL";
  productionParser: Readonly<{
    ok: boolean;
    code: string | null;
    field: string | null;
  }>;
  firstFailingCheck: Readonly<{
    category: "structural" | "contextual_reference";
    code: string;
    path: string;
  }> | null;
  structuralViolations: readonly QualificationSemanticDiagnosticViolation[];
  contextualReferenceViolations: readonly QualificationSemanticDiagnosticViolation[];
  semanticViolationsAfterStructuralAcceptance:
    | readonly QualificationSemanticDiagnosticViolation[]
    | "NOT_REACHED";
}>;

export type QualificationGateName =
  | "jsonSyntax"
  | "closedSchemaConformance"
  | "strictParser"
  | "kernelBinding"
  | "semanticValidity"
  | "fencing"
  | "authorityReachability"
  | "resourcePolicy";

export type QualificationFirstFailureBoundary =
  | "PRE_DISPATCH_LOCAL_FAILURE"
  | "REQUEST_DISPATCHED_NO_RESPONSE"
  | "PROVIDER_ERROR_RESPONSE"
  | "PROVIDER_CONTENT_RECEIVED"
  | "LOCAL_JSON_REJECTION"
  | "LOCAL_SCHEMA_REJECTION"
  | "STRICT_PARSER_REJECTION"
  | "KERNEL_BINDING_REJECTION"
  | "SEMANTIC_VALIDITY_REJECTION"
  | "FENCING_REJECTION"
  | "AUTHORITY_REACHABILITY_REJECTION"
  | "RESOURCE_POLICY_REJECTION"
  | "NOT_REACHED";

export type QualificationReachability = "PASS" | "FAIL" | "NOT_REACHED";

export type QualificationGateDiagnostic = Readonly<{
  status: QualificationGateStatus;
  reasonCodes: readonly string[];
  expected: Readonly<Record<string, unknown>> | null;
  actual: Readonly<Record<string, unknown>> | null;
}>;

export type QualificationCorrectionPacket = Readonly<{
  attemptOrdinal: number;
  attemptKind: "initial" | "structural_correction";
  invocationId: string | null;
  providerAttemptId: string | null;
  systemMessage: string;
}>;

export type QualificationFailureEvidence = Readonly<{
  captureStatus: "captured" | "not_applicable" | "diagnostic_capture_too_large";
  allowlistedReferences: readonly string[];
  providerContentChunkMetadata: ProviderResponseDiagnostics | null;
  normalizedSemanticText: string | null;
  normalizedSemanticBytes: number;
  normalizedSemanticSHA256: `sha256:${string}`;
  jsonSyntaxDiagnostic: Readonly<{
    code: string;
    message: string;
  }> | null;
  closedSchemaDiagnostic: Readonly<{
    code: string;
    keyword: string | null;
    instancePath: string;
    schemaPath: string;
    branch: string | null;
  }> | null;
  strictParserDiagnostic: Readonly<{
    parserErrorCode: string;
    parserErrorMessage: string;
    parserPath: string | null;
    expectedShape: string;
    observedShapeSummary: Readonly<Record<string, unknown>>;
  }> | null;
  semanticValidityDiagnostic: Readonly<{
    reasonCodes: readonly string[];
    offendingFieldPaths: readonly string[];
    evidenceRefDiagnostics: readonly string[];
  }> | null;
  kernelBindingDiagnostic: QualificationGateDiagnostic;
  fencingDiagnostic: QualificationGateDiagnostic;
  authorityReachabilityDiagnostic: QualificationGateDiagnostic;
  hostContext: Readonly<{
    cycleId: string;
    generation: number;
    occupantId: string;
    authorityEpoch: number;
    triggerRef: string;
  }> | null;
}>;

export type QualificationDiagnostics = Readonly<{
  firstFailureBoundary: QualificationFirstFailureBoundary;
  closedSchemaFailureKeyword: string | null;
  closedSchemaFailureInstancePath: string | null;
  closedSchemaFailureSchemaPath: string | null;
  closedSchemaFailureBranch: string | null;
  errorCode: string | null;
  dispatchTruth: DispatchTruth | null;
  dispatchStage: ModelFailure["stage"] | null;
  providerRequestStarted: boolean;
  providerResponseReceived: boolean;
  attemptId: string | null;
  reachability: Readonly<{
    kernelBinding: QualificationReachability;
    fencing: QualificationReachability;
    authorityReachability: QualificationReachability;
    semanticValidity: QualificationReachability;
  }>;
}>;

export type ThoughtQualificationCaseResult = Readonly<{
  caseId: ThoughtQualificationCaseId;
  invocationIds: readonly string[];
  providerAttemptIds: readonly string[];
  transport: "success" | "failure";
  rawContentBytes: number;
  rawContentDigest: `sha256:${string}`;
  closedSchemaConformance: QualificationGateStatus;
  jsonSyntax: QualificationGateStatus;
  strictParser: QualificationGateStatus;
  kernelBinding: QualificationGateStatus;
  fencing: QualificationGateStatus;
  authorityReachability: QualificationGateStatus;
  semanticValidity: QualificationGateStatus;
  resourcePolicy: QualificationGateStatus;
  elapsedMs: number;
  outputTokens: number | null;
  wireMode: string | null;
  wireBindingId: string | null;
  providerDeclaredEnforcement: string | null;
  capabilityFingerprint: string | null;
  diagnostics: QualificationDiagnostics;
  firstFailureBoundary: QualificationFirstFailureBoundary;
  independentFailureCodes: readonly string[];
  dependentNotReachedGates: readonly QualificationGateName[];
  correctionPackets: readonly QualificationCorrectionPacket[];
  failureEvidence: QualificationFailureEvidence | null;
  failureCodes: readonly string[];
  verdict: "PASS" | "NOT_QUALIFIED";
  /**
   * Production-parity Authority-revision evidence (live path only).
   * Additive metadata: records every evaluated semantic pass so the initial
   * rejection is preserved alongside the final converged verdict. Absent for
   * fixture (W0) sequences.
   */
  authorityRevision?: Readonly<{
    attempted: boolean;
    revisionCount: number;
    passes: readonly Readonly<{
      semanticPass: number;
      authorityCodes: readonly string[];
      verdict: "PASS" | "REVISION_REQUIRED" | "TERMINAL";
    }>[];
  }>;
}>;

export type ThoughtQualificationNegativeWitness = ThoughtQualificationCaseResult & Readonly<{
  witness: string;
}>;

export type ThoughtRouteQualification = Readonly<{
  schema: "ashley.thought.route_qualification.v1";
  candidate: {
    provider: "cloudflare";
    model: "@cf/deepseek-ai/deepseek-v4-flash-0731";
    occupantId: string;
  };
  capabilityFingerprint: string;
  runId: string;
  environment: ThoughtQualificationEnvironment;
  cases: readonly ThoughtQualificationCaseResult[];
  negativeWitnesses?: readonly ThoughtQualificationNegativeWitness[];
  preflight?: Readonly<Record<string, unknown>>;
  outputDirectory?: string | null;
  qualificationResultPath?: string | null;
  /**
   * Qualification-campaign scheduling evidence (live path only). Records WHEN
   * samples were scheduled, never model behavior and never a verdict input.
   */
  campaign?: Readonly<{
    interLiveCaseDelayMs: number;
  }>;
  verdict: "PASS" | "NOT_QUALIFIED" | "NOT_RUN" | "OUTCOME_UNKNOWN";
}>;
