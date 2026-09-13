export const EXIT_CODES = {
  OK: 0,
  TRANSIENT: 1,
  INHIBITED_UNTIL: 75,
  OPERATOR_REQUIRED: 78,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
