import type { DatabaseSync } from "node:sqlite";

export type ThoughtAttemptCounters = {
  thoughtModelAttempts: number;
  acceptedThoughtPasses: number;
  structuralRetries: number;
  composeCancelledAttempts: number;
  authorityRevisions: number;
  observationRounds: number;
  effectRounds: number;
};

export type ThoughtCounterField = keyof ThoughtAttemptCounters;

const FIELDS: ThoughtCounterField[] = [
  "thoughtModelAttempts",
  "acceptedThoughtPasses",
  "structuralRetries",
  "composeCancelledAttempts",
  "authorityRevisions",
  "observationRounds",
  "effectRounds",
];

const COLUMN: Record<ThoughtCounterField, string> = {
  thoughtModelAttempts: "thought_model_attempts",
  acceptedThoughtPasses: "accepted_thought_passes",
  structuralRetries: "structural_retries",
  composeCancelledAttempts: "compose_cancelled_attempts",
  authorityRevisions: "authority_revisions",
  observationRounds: "observation_rounds",
  effectRounds: "effect_rounds",
};

function numberValue(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function emptyCounters(): ThoughtAttemptCounters {
  return {
    thoughtModelAttempts: 0,
    acceptedThoughtPasses: 0,
    structuralRetries: 0,
    composeCancelledAttempts: 0,
    authorityRevisions: 0,
    observationRounds: 0,
    effectRounds: 0,
  };
}

export function ensureThoughtAttemptCounters(
  db: DatabaseSync,
  cycleId: string,
  generation: number,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO thought_attempt_counters (cycle_id, generation)
     VALUES (?, ?)`,
  ).run(cycleId, generation);
}

export function getThoughtAttemptCounters(
  db: DatabaseSync,
  cycleId: string,
  generation: number,
): ThoughtAttemptCounters {
  ensureThoughtAttemptCounters(db, cycleId, generation);
  const row = db.prepare(
    `SELECT thought_model_attempts, accepted_thought_passes, structural_retries,
            compose_cancelled_attempts, authority_revisions, observation_rounds,
            effect_rounds
       FROM thought_attempt_counters
      WHERE cycle_id = ? AND generation = ?`,
  ).get(cycleId, generation) as Record<string, unknown> | undefined;
  if (!row) return emptyCounters();
  return {
    thoughtModelAttempts: numberValue(row.thought_model_attempts),
    acceptedThoughtPasses: numberValue(row.accepted_thought_passes),
    structuralRetries: numberValue(row.structural_retries),
    composeCancelledAttempts: numberValue(row.compose_cancelled_attempts),
    authorityRevisions: numberValue(row.authority_revisions),
    observationRounds: numberValue(row.observation_rounds),
    effectRounds: numberValue(row.effect_rounds),
  };
}

export function incrementThoughtAttemptCounter(
  db: DatabaseSync,
  cycleId: string,
  generation: number,
  field: ThoughtCounterField,
  amount = 1,
): ThoughtAttemptCounters {
  if (!FIELDS.includes(field)) throw new Error("thought_counter_field_invalid");
  ensureThoughtAttemptCounters(db, cycleId, generation);
  const column = COLUMN[field];
  db.prepare(
    `UPDATE thought_attempt_counters
        SET ${column} = ${column} + ?
      WHERE cycle_id = ? AND generation = ?`,
  ).run(amount, cycleId, generation);
  return getThoughtAttemptCounters(db, cycleId, generation);
}
