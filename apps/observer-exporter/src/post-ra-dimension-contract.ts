export const POST_RA_COVERAGE_DIMENSIONS = [
  "meaningful_proactivity",
  "concern_lifecycle",
  "learned_personality",
  "personal_workspace_use",
  "current_world_awareness",
  "audience_aware_expression",
  "self_inspection",
  "sustained_inquiry",
  "candidate_improvement",
  "failure_repair",
] as const;

export type PostRaCoverageDimension = (typeof POST_RA_COVERAGE_DIMENSIONS)[number];
export type PostRaDimensionStatus = "SUPPORTED" | "AWAITING-BEHAVIOR";

export type PostRaDimensionContract = {
  dimension: PostRaCoverageDimension;
  status: PostRaDimensionStatus;
  basis: "existing_behavior" | "behavior_not_yet_present";
};

export const POST_RA_DIMENSION_CONTRACT: readonly PostRaDimensionContract[] = [
  { dimension: "meaningful_proactivity", status: "SUPPORTED", basis: "existing_behavior" },
  { dimension: "concern_lifecycle", status: "SUPPORTED", basis: "existing_behavior" },
  { dimension: "learned_personality", status: "AWAITING-BEHAVIOR", basis: "behavior_not_yet_present" },
  { dimension: "personal_workspace_use", status: "AWAITING-BEHAVIOR", basis: "behavior_not_yet_present" },
  { dimension: "current_world_awareness", status: "AWAITING-BEHAVIOR", basis: "behavior_not_yet_present" },
  { dimension: "audience_aware_expression", status: "SUPPORTED", basis: "existing_behavior" },
  { dimension: "self_inspection", status: "AWAITING-BEHAVIOR", basis: "behavior_not_yet_present" },
  { dimension: "sustained_inquiry", status: "AWAITING-BEHAVIOR", basis: "behavior_not_yet_present" },
  { dimension: "candidate_improvement", status: "AWAITING-BEHAVIOR", basis: "behavior_not_yet_present" },
  { dimension: "failure_repair", status: "AWAITING-BEHAVIOR", basis: "behavior_not_yet_present" },
];

export function resolvePostRaDimensionContract(): readonly PostRaDimensionContract[] {
  return POST_RA_DIMENSION_CONTRACT.map((entry) => ({ ...entry }));
}

export const POST_RA_PACKET_COVERAGE_OBLIGATIONS = [
  {
    packet: "P-W1-01",
    obligation: "Desk surfaces allowlisted + migration note for vault; compatibility change iff first actual exporter-visible incompatibility",
  },
  {
    packet: "P-W1-02",
    obligation: "Assertion-kind/audience/license facet coverage; compatibility change iff first actual exporter-visible incompatibility",
  },
  {
    packet: "P-W1-03",
    obligation: "Commitment/proactivity surface coverage including commitment_settlements states and due/defer/missed",
  },
  {
    packet: "P-W2-01A",
    obligation: "Intake-mapping + retrieval-scope refusal coverage on existing surfaces",
  },
  {
    packet: "P-W2-01B",
    obligation: "Dispatch-refusal + license re-resolution verdict coverage on existing delivery surfaces",
  },
  {
    packet: "P-W2-02A",
    obligation: "External-intake provenance coverage; compatibility change iff first actual exporter-visible incompatibility",
  },
  {
    packet: "P-W2-02B",
    obligation: "Watch lifecycle coverage: adopt, fire, operational expiry, and Thought retirement",
  },
  {
    packet: "P-W2-03",
    obligation: "None in campaign; Class C/deferred and no new expression-class surface",
  },
  {
    packet: "P-W3-01",
    obligation: "Inspection-adoption coverage; compatibility change iff first actual exporter-visible incompatibility",
  },
  {
    packet: "P-W3-02A",
    obligation: "Inquiry-lifecycle coverage; compatibility change iff first actual exporter-visible incompatibility",
  },
  {
    packet: "P-W3-03",
    obligation: "Experiment-lifecycle coverage; compatibility change iff first actual exporter-visible incompatibility",
  },
  {
    packet: "P-W4-01",
    obligation: "Candidate lifecycle coverage for adopt/author/verify/adjudicate/export; notification is separate publication",
  },
] as const;

export type PostRaEvidenceSurface = {
  source: "nuclear" | "cognitive_sidecar";
  table: string;
  columns: readonly string[];
};

export const POST_RA_P_W1_00_EVIDENCE_SURFACES: readonly PostRaEvidenceSurface[] = [
  { source: "cognitive_sidecar", table: "settlements", columns: ["payload_json"] },
  { source: "cognitive_sidecar", table: "speech_outbox", columns: ["settlement_id", "nuclear_reservation_id"] },
  { source: "nuclear", table: "delivery_reservations", columns: ["delivery_lane", "state"] },
];
