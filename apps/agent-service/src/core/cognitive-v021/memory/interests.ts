import type { DatabaseSync } from "node:sqlite";

/**
 * Growth V1 §6.3: the interest graph.
 *
 * The 50 roots are Ashley's from day one and never change. Specific tastes
 * are branches under a root. A branch grows only when Ashley lives it (a
 * read she valued, a conversation, a take) and says so in a settlement;
 * branches she leaves alone fade in ranking but stay in history. The Host
 * keeps the arithmetic and never picks a branch for her.
 */

export const INTEREST_ROOTS = Object.freeze([
  "Electronic music", "Technology", "Artificial intelligence", "Psychology & the mind", "Neuroscience",
  "Video games (strategy & systems)", "Philosophy", "Science & space", "Internet culture", "Film & TV",
  "Books & essays", "Design & architecture", "History", "Politics & society", "Music production & sound",
  "Art & visual culture", "Fashion & style", "Food & cooking", "Nature & animals", "Economics & markets",
  "Language & words", "Math & puzzles", "True crime & mysteries", "Cities & travel", "Esports & competition",
  "Mythology & the strange", "Health & the body", "Comedy & humour", "Photography",
  "How people behave in relationships", "Theology", "Psychopharmacology", "Psychedelia", "Absurd humour",
  "Mysticism & religious experience", "Consciousness studies", "Dreams & altered states",
  "Ethics & moral dilemmas", "Existentialism & meaning", "Occultism & esoteric history",
  "Comparative religion", "Surrealism & dada", "Cult films & weird cinema", "Experimental & ambient music",
  "Sci-fi & speculative fiction", "Cognitive biases", "Drug policy & harm reduction",
  "Cosmology & big questions", "Folklore & urban legends", "Satire & dark comedy",
] as const);

export type InterestRoot = (typeof INTEREST_ROOTS)[number];

export const INTEREST_BRANCH_MAX_CHARS = 80;
export const INTEREST_NOTE_MAX_CHARS = 300;
export const INTEREST_TOUCHES_MAX = 5;
/** A branch left alone loses half its weight every 30 days. */
export const INTEREST_HALF_LIFE_MS = 30 * 24 * 60 * 60_000;

/** One interest Ashley lived in a settlement: the root, the branch, and why. */
export type InterestTouch = { root: string; branch: string; note?: string };

export type InterestBranch = {
  branchId: string;
  root: InterestRoot;
  label: string;
  origin: "seed" | "ashley";
  livedCount: number;
  lastNote: string | null;
  lastLivedAtMs: number | null;
  strength: number;
};

type Row = Record<string, unknown>;

const ROOTS = new Set<string>(INTEREST_ROOTS);

export function isInterestRoot(value: unknown): value is InterestRoot {
  return typeof value === "string" && ROOTS.has(value);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Deterministic, readable branch id: the same root and label are one branch. */
export function interestBranchIdFor(root: string, label: string): string {
  return `${slug(root)}/${slug(label)}`;
}

export function interestStrength(livedCount: number, lastLivedAtMs: number | null, nowMs: number): number {
  if (livedCount <= 0 || lastLivedAtMs === null) return 0;
  const age = Math.max(0, nowMs - lastLivedAtMs);
  return (1 + Math.log(1 + livedCount)) * 0.5 ** (age / INTEREST_HALF_LIFE_MS);
}

function mapBranch(row: Row, nowMs: number): InterestBranch | null {
  if (!isInterestRoot(row.root)) return null;
  const livedCount = Number(row.lived_count ?? 0);
  const lastLivedAtMs = row.last_lived_at_ms == null ? null : Number(row.last_lived_at_ms);
  return {
    branchId: String(row.branch_id),
    root: row.root,
    label: String(row.label),
    origin: row.origin === "seed" ? "seed" : "ashley",
    livedCount,
    lastNote: typeof row.last_note === "string" ? row.last_note : null,
    lastLivedAtMs,
    strength: Math.round(interestStrength(livedCount, lastLivedAtMs, nowMs) * 1000) / 1000,
  };
}

/** Live branches, strongest first. */
export function listInterestBranches(db: DatabaseSync, nowMs: number, limit = 200): InterestBranch[] {
  return (db.prepare("SELECT * FROM interest_branches WHERE forgotten_at_ms IS NULL").all() as Row[])
    .flatMap((row) => {
      const branch = mapBranch(row, nowMs);
      return branch ? [branch] : [];
    })
    .sort((a, b) => b.strength - a.strength || a.branchId.localeCompare(b.branchId))
    .slice(0, Math.max(0, limit));
}

/**
 * Record the interests a settlement says Ashley lived. An unknown root or an
 * empty branch is dropped (the Host never guesses which root she meant).
 * Returns the branch ids that grew.
 */
export function recordInterestTouches(
  db: DatabaseSync,
  touches: readonly InterestTouch[],
  nowMs: number,
): string[] {
  const grown: string[] = [];
  for (const touch of touches.slice(0, INTEREST_TOUCHES_MAX)) {
    const label = touch.branch.trim().slice(0, INTEREST_BRANCH_MAX_CHARS);
    if (!isInterestRoot(touch.root) || !label) continue;
    const branchId = interestBranchIdFor(touch.root, label);
    if (!branchId.includes("/") || branchId.endsWith("/") || grown.includes(branchId)) continue;
    const note = touch.note?.trim().slice(0, INTEREST_NOTE_MAX_CHARS) || null;
    db.prepare(
      `INSERT INTO interest_branches (branch_id, root, label, origin, lived_count, last_note, created_at_ms, last_lived_at_ms)
       VALUES (?, ?, ?, 'ashley', 1, ?, ?, ?)
       ON CONFLICT(branch_id) DO UPDATE SET
         lived_count = interest_branches.lived_count + 1,
         last_note = COALESCE(excluded.last_note, interest_branches.last_note),
         last_lived_at_ms = excluded.last_lived_at_ms`,
    ).run(branchId, touch.root, label, note, nowMs, nowMs);
    grown.push(branchId);
  }
  return grown;
}

/** Branches whose own words mention a forgotten topic. */
export function interestBranchIdsForForget(db: DatabaseSync, topic: string): string[] {
  const needle = topic.trim().toLowerCase();
  if (!needle) return [];
  return (db.prepare("SELECT branch_id, label, last_note FROM interest_branches WHERE forgotten_at_ms IS NULL").all() as Row[])
    .filter((row) => `${String(row.label)}\n${typeof row.last_note === "string" ? row.last_note : ""}`.toLowerCase().includes(needle))
    .map((row) => String(row.branch_id));
}

/** The branch id is built from its label, so a forgotten branch is removed outright. */
export function forgetInterestBranch(db: DatabaseSync, branchId: string): number {
  return Number(db.prepare("DELETE FROM interest_branches WHERE branch_id = ?").run(branchId).changes ?? 0);
}
