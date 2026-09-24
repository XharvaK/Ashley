export type EffectExecutionControl = {
  signal: AbortSignal;
  deadlineAtMs: number;
};

export class EffectOwnershipLostError extends Error {
  readonly code: string;

  constructor(code = "effect_ownership_lost") {
    super(code);
    this.name = "EffectOwnershipLostError";
    this.code = code;
  }
}
