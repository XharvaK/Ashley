export const MODE_B_INVESTIGATE = "project.investigate" as const;
export const MODE_B_DEVELOP = "candidate.develop" as const;
export const MODE_B_HOST_MAX_STEPS = 128 as const;

export const DETACHED_WORKER_MAX_WALL_CLOCK_MS = 3_600_000 as const;
export const WORKER_FINALIZATION_RESERVE_MS = 30_000 as const;
export const WORKER_MODEL_TURN_MAX_MS = 300_000 as const;
