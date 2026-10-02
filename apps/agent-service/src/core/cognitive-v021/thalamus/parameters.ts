// The Host records bounded attention parameters; Thought owns meaning and no parameter activates a wake.

export const THALAMUS_RULES = {
  ownerMessageRoute: "existing_ingress",
  ownerMessageUsesArbiter: false,
  coverageEdgeClass: "ALWAYS_THROUGH",
  dueCommitmentClass: "ALWAYS_THROUGH",
  sleepCeilingClass: "ALWAYS_THROUGH",
  sleepTimeFloorMs: null,
  budgetOwner: "private_budget_policy",
  calibrationStatus: "PROVISIONAL",
  provisionalTuningOwner: "T5",
} as const;

// Bounds describe the parameter contract, not permission to change live policy.
// PROVISIONAL defaults remain subject to offline calibration before release.
export const THALAMUS_PARAMETERS = {
  theta0: {
    units: "normalized salience", default: 0.5, learningBound: { min: 0.25, max: 0.75 },
    source: "architect default", status: "PROVISIONAL",
  },
  calibrationTolerance: {
    units: "fraction of baseline passes/day", default: 0.2, learningBound: { min: 0.2, max: 0.2 },
    source: "parameter contract: calibration ruling", status: "FIXED",
  },
  salienceMinimum: {
    units: "normalized salience", default: 0, learningBound: { min: 0, max: 0 },
    source: "organism A3", status: "FIXED",
  },
  salienceMaximum: {
    units: "normalized salience", default: 1, learningBound: { min: 1, max: 1 },
    source: "organism A3", status: "FIXED",
  },
  ambientHabituationAlpha: {
    units: "fraction per repeat", default: 0.3, learningBound: { min: 0.3, max: 0.8 },
    source: "parameter contract: repetition ruling", status: "BOUNDED",
  },
  socialHabituationAlpha: {
    units: "fraction per repeat", default: 0.1, learningBound: { min: 0, max: 0.8 },
    source: "architect default", status: "PROVISIONAL",
  },
  ambientRepetitionAcceptanceCount: {
    units: "repetitions", default: 5, learningBound: { min: 5, max: 5 },
    source: "parameter contract: repetition ruling", status: "FIXED",
  },
  ambientResponseAcceptanceCeiling: {
    units: "response fraction", default: 0.2, learningBound: { min: 0.2, max: 0.2 },
    source: "parameter contract: repetition ruling", status: "FIXED",
  },
  moodAmplitude: {
    units: "fraction", default: 0.15, learningBound: { min: 0.15, max: 0.15 },
    source: "parameter contract: mood ruling", status: "FIXED",
  },
  nucleusGain: {
    units: "multiplier", default: 1, learningBound: { min: 0.5, max: 2 },
    source: "organism A7", status: "BOUNDED",
  },
  familyGain: {
    units: "multiplier", default: 1, learningBound: { min: 0.5, max: 2 },
    source: "organism A7", status: "BOUNDED",
  },
  learningEmaAlpha: {
    units: "fraction per adjudicated wake", default: 0.05, learningBound: { min: 0.01, max: 0.1 },
    source: "architect default", status: "PROVISIONAL",
  },
  gainYesTarget: {
    units: "multiplier", default: 1.25, learningBound: { min: 1, max: 2 },
    source: "architect default", status: "PROVISIONAL",
  },
  gainNoTarget: {
    units: "multiplier", default: 0.5, learningBound: { min: 0.5, max: 1 },
    source: "architect default", status: "PROVISIONAL",
  },
  gainSoonerTarget: {
    units: "multiplier", default: 2, learningBound: { min: 1, max: 2 },
    source: "architect default", status: "PROVISIONAL",
  },
  gainLaterTarget: {
    units: "multiplier", default: 0.75, learningBound: { min: 0.5, max: 1 },
    source: "architect default", status: "PROVISIONAL",
  },
  fatigueAmplitude: {
    units: "threshold multiplier above baseline", default: 0.5, learningBound: { min: 0, max: 1 },
    source: "architect default", status: "PROVISIONAL",
  },
  fatigueExponent: {
    units: "dimensionless exponent", default: 2, learningBound: { min: 1, max: 3 },
    source: "architect default", status: "PROVISIONAL",
  },
  circadianAmplitude: {
    units: "fraction", default: 0.1, learningBound: { min: 0, max: 0.25 },
    source: "architect default", status: "PROVISIONAL",
  },
  arousalLeakMs: {
    units: "milliseconds", default: 60000, learningBound: { min: 30000, max: 300000 },
    source: "architect default", status: "PROVISIONAL",
  },
  arousalResetFraction: {
    units: "fraction remaining after wake", default: 0, learningBound: { min: 0, max: 0.25 },
    source: "architect default", status: "PROVISIONAL",
  },
  habituationRecoveryMs: {
    units: "milliseconds", default: 3600000, learningBound: { min: 300000, max: 14400000 },
    source: "architect default", status: "PROVISIONAL",
  },
  dishabituationRecoveryFraction: {
    units: "fraction of lost response restored", default: 0.5, learningBound: { min: 0, max: 1 },
    source: "architect default", status: "PROVISIONAL",
  },
  reflectiveRefractoryMs: {
    units: "milliseconds", default: 60000, learningBound: { min: 0, max: 120000 },
    source: "architect default", status: "PROVISIONAL",
  },
  sleepRefractoryMs: {
    units: "milliseconds", default: 3600000, learningBound: { min: 0, max: 7200000 },
    source: "architect default", status: "PROVISIONAL",
  },
  prospectiveRefractoryMs: {
    units: "milliseconds", default: 0, learningBound: { min: 0, max: 0 },
    source: "architect default", status: "PROVISIONAL",
  },
  externalRefractoryMs: {
    units: "milliseconds", default: 300000, learningBound: { min: 0, max: 600000 },
    source: "architect default", status: "PROVISIONAL",
  },
  boredomRefractoryMs: {
    units: "milliseconds", default: 300000, learningBound: { min: 0, max: 600000 },
    source: "architect default", status: "PROVISIONAL",
  },
  interoceptiveRefractoryMs: {
    units: "milliseconds", default: 3600000, learningBound: { min: 0, max: 7200000 },
    source: "architect default", status: "PROVISIONAL",
  },
  socialRefractoryMs: {
    units: "milliseconds", default: 60000, learningBound: { min: 0, max: 120000 },
    source: "architect default", status: "PROVISIONAL",
  },
  reflectionWindowRows: {
    units: "rows", default: 40, learningBound: { min: 40, max: 40 },
    source: "parameter contract: coverage ruling", status: "FIXED",
  },
  reflectiveRowsAtFullPressure: {
    units: "unreflected rows", default: 20, learningBound: { min: 1, max: 39 },
    source: "architect default", status: "PROVISIONAL",
  },
  reflectiveIdleMsAtFullPressure: {
    units: "milliseconds", default: 3600000, learningBound: { min: 300000, max: 10800000 },
    source: "architect default", status: "PROVISIONAL",
  },
  sleepPressureCeiling: {
    units: "normalized work units", default: 100, learningBound: { min: 100, max: 100 },
    source: "architect default", status: "PROVISIONAL",
  },
  episodeWorkWeight: {
    units: "work units per item", default: 5, learningBound: { min: 2.5, max: 10 },
    source: "architect default", status: "PROVISIONAL",
  },
  memoryWorkWeight: {
    units: "work units per item", default: 3, learningBound: { min: 1.5, max: 6 },
    source: "architect default", status: "PROVISIONAL",
  },
  rowWorkWeight: {
    units: "work units per item", default: 1, learningBound: { min: 0.5, max: 2 },
    source: "architect default", status: "PROVISIONAL",
  },
  revisionWorkWeight: {
    units: "work units per item", default: 5, learningBound: { min: 2.5, max: 10 },
    source: "architect default", status: "PROVISIONAL",
  },
  expectationWorkWeight: {
    units: "work units per item", default: 2, learningBound: { min: 1.0, max: 4 },
    source: "architect default", status: "PROVISIONAL",
  },
  sleepQuietHourAmplitude: {
    units: "fraction", default: 0.5, learningBound: { min: 0, max: 1 },
    source: "architect default", status: "PROVISIONAL",
  },
  boredomRiseMs: {
    units: "milliseconds to unit pressure", default: 10800000, learningBound: { min: 3600000, max: 21600000 },
    source: "architect default", status: "PROVISIONAL",
  },
  restingRiseMultiplier: {
    units: "duration multiplier", default: 2, learningBound: { min: 1, max: 4 },
    source: "architect default", status: "PROVISIONAL",
  },
  watchPerSettlement: {
    units: "items", default: 4, learningBound: { min: 4, max: 4 },
    source: "attention contract", status: "FIXED",
  },
  watchLive: {
    units: "items", default: 16, learningBound: { min: 16, max: 16 },
    source: "organism A6", status: "FIXED",
  },
  watchNoteCharacters: {
    units: "characters", default: 200, learningBound: { min: 200, max: 200 },
    source: "organism A6", status: "FIXED",
  },
  decisionRetentionMs: {
    units: "milliseconds", default: 2592000000, learningBound: { min: 2592000000, max: 2592000000 },
    source: "attention contract", status: "FIXED",
  },
  schedulerContractVersion: {
    units: "version", default: 1, learningBound: { min: 1, max: 1 },
    source: "scheduler handoff contract v1", status: "FIXED",
  },
  schedulerPollMs: {
    units: "milliseconds", default: 60000, learningBound: { min: 60000, max: 60000 },
    source: "architect default", status: "PROVISIONAL",
  },
  backupFailureWakeAgeMs: {
    units: "milliseconds", default: 172800000, learningBound: { min: 172800000, max: 172800000 },
    source: "architect default", status: "PROVISIONAL",
  },
  weeklyArcCadenceMs: {
    units: "milliseconds", default: 604800000, learningBound: { min: 604800000, max: 604800000 },
    source: "organism A4; existing NIGHT cadence", status: "FIXED",
  },
} as const;
