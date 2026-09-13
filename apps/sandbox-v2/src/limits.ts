/**
 * Sandbox V2 capability-kernel limits (Sandbox V2 M2).
 *
 * Every bound is a hard ceiling owned by the kernel; model/user input can
 * only tighten (e.g. `maxMatches`), never loosen. The Bubblewrap host facts
 * below were resolved during M0/M1 on the production Linux Mint host and are
 * reused verbatim by the M2 executor (M1 launcher remains frozen).
 */

export const V2_LIMITS = {
  // Host launcher bounds
  REQUEST_MAX_BYTES: 16 * 1024,
  STDOUT_MAX_BYTES: 256 * 1024,
  STDERR_MAX_BYTES: 64 * 1024,
  TIMEOUT_MS: 60_000,
  CONTENT_MAX_CHARS: 2048,

  // project.read_file
  READ_MAX_BYTES: 64 * 1024,

  // project.list_directory
  LIST_MAX_ENTRIES: 2000,

  // project.search_text
  SEARCH_PATTERN_MAX: 256,
  SEARCH_MAX_MATCHES: 2000,
  SEARCH_MAX_FILES: 2000,
  SEARCH_MAX_FILE_BYTES: 128 * 1024,
  SEARCH_MAX_DEPTH: 12,
  SEARCH_MATCH_TEXT_MAX: 512,

  // Sanitized source view copy ceilings
  VIEW_MAX_FILES: 10_000,
  VIEW_MAX_BYTES: 100 * 1024 * 1024,
  VIEW_MAX_SINGLE_FILE_BYTES: 25 * 1024 * 1024,
  VIEW_MAX_PATH_LENGTH: 1024,
  VIEW_MAX_DEPTH: 32,
  VIEW_MAX_EXCLUDED_ENTRIES: 20_000,

  // Request field bounds
  PROJECT_ID_MAX: 128,
  PATH_MAX: 1024,
  RECIPE_ID_MAX: 128,
  RECIPE_VERSION_MAX: 64,

  // Workspace experiment bounds (M3)
  WORKSPACE_MAX_BYTES: 100 * 1024 * 1024,
  WORKSPACE_REQUEST_MAX_BYTES: 128 * 1024,
  M3_WRITE_MAX_BYTES: 64 * 1024,

  // Candidate authorship bounds (M5)
  CHANGESET_MAX_PATHS: 32,
  CHANGESET_MAX_PATCH_BYTES: 256 * 1024,
  CHANGESET_PATH_MAX: 1024,
} as const;

/**
 * Frozen M0/M1-resolved production host facts (Linux Mint). Do not broaden
 * filesystem exposure. Mirrors the frozen M1 launcher constants.
 */
export const V2_HOST_FACTS = {
  BWRAP: "/usr/bin/bwrap",
  NODE_BIN: "/opt/node/bin/node",
  NVM_NODE_PREFIX: "/home/xarvak/.nvm/versions/node/v22.23.2",
  PROJECT_MOUNT: "/project",
  PATH_VALUE: "/usr/bin",
  HOME_VALUE: "/tmp",
} as const;

/** Host environment secret sentinel key (distinct from the M1 sentinel). */
export const V2_SECRET_ENV_KEY = "ASHLEY_SANDBOX_V2_SECRET_SENTINEL";