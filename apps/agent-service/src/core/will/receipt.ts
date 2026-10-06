// F1: a weekly life receipt. Facts counted from her own records over the last seven days: what her
// own time went to, what she read, her pursuits, her acts in each place, what she made in her home,
// and the interests she lived. A receipt, not a score: nothing here is judged or ranked.
import type { DatabaseSync } from "node:sqlite";
import { placeLabel } from "../places/places.js";

export const LIFE_RECEIPT_WINDOW_MS = 7 * 24 * 60 * 60_000;

export type LifeReceipt = {
  sinceMs: number;
  ownTime: { passes: number; spoke: number; activities: Record<string, number> };
  night: number;
  reads: { journal: number; webRequests: number };
  pursuits: { started: number; touched: number; finished: number; activeNow: number };
  places: Array<{ place: string; posted: number; refused: number }>;
  home: { changes: number; files: string[] };
  interests: { lived: string[]; new: string[] };
};

type Row = Record<string, unknown>;

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function count(db: DatabaseSync, sql: string, ...params: Array<string | number>): number {
  return Number((db.prepare(sql).get(...params) as Row | undefined)?.n ?? 0);
}

export function lifeReceipt(sidecar: DatabaseSync, nowMs: number): LifeReceipt {
  const since = nowMs - LIFE_RECEIPT_WINDOW_MS;
  const activities: Record<string, number> = {};
  for (const row of sidecar.prepare(`SELECT coalesce(activity, 'none') AS activity, count(*) AS n FROM activity_journal
    WHERE pass_kind = 'awake' AND created_at_ms > ? AND forgotten_at_ms IS NULL GROUP BY 1 ORDER BY 2 DESC`).all(since) as Row[]) {
    activities[String(row.activity)] = Number(row.n);
  }
  const live = "created_at_ms > ? AND forgotten_at_ms IS NULL";
  const receipt: LifeReceipt = {
    sinceMs: since,
    ownTime: {
      passes: Object.values(activities).reduce((sum, n) => sum + n, 0),
      spoke: count(sidecar, `SELECT count(*) AS n FROM activity_journal WHERE pass_kind = 'awake' AND spoke = 1 AND ${live}`, since),
      activities,
    },
    night: count(sidecar, `SELECT count(*) AS n FROM activity_journal WHERE pass_kind = 'night' AND ${live}`, since),
    reads: {
      journal: count(sidecar, `SELECT count(*) AS n FROM activity_journal WHERE read_refs_json != '[]' AND ${live}`, since),
      webRequests: tableExists(sidecar, "web_requests") ? count(sidecar, "SELECT count(*) AS n FROM web_requests WHERE at_ms > ?", since) : 0,
    },
    pursuits: { started: 0, touched: 0, finished: 0, activeNow: 0 },
    places: [],
    home: { changes: 0, files: [] },
    interests: {
      lived: (sidecar.prepare(`SELECT label FROM interest_branches WHERE last_lived_at_ms > ? AND forgotten_at_ms IS NULL
        AND NOT (origin = 'seed' AND lived_count <= 1) ORDER BY last_lived_at_ms DESC LIMIT 12`).all(since) as Row[]).map(row => String(row.label)),
      new: (sidecar.prepare(`SELECT label FROM interest_branches WHERE created_at_ms > ? AND origin != 'seed' AND forgotten_at_ms IS NULL
        ORDER BY created_at_ms LIMIT 12`).all(since) as Row[]).map(row => String(row.label)),
    },
  };
  if (tableExists(sidecar, "pursuits")) {
    receipt.pursuits = {
      started: count(sidecar, "SELECT count(*) AS n FROM pursuits WHERE started_at_ms > ?", since),
      touched: count(sidecar, "SELECT count(*) AS n FROM pursuits WHERE updated_at_ms > ?", since),
      finished: count(sidecar, "SELECT count(*) AS n FROM pursuits WHERE state = 'finished' AND ended_at_ms > ?", since),
      activeNow: count(sidecar, "SELECT count(*) AS n FROM pursuits WHERE state = 'active'"),
    };
  }
  if (tableExists(sidecar, "place_intents")) {
    receipt.places = (sidecar.prepare(`SELECT place_ref, sum(state = 'posted') AS posted, sum(state = 'refused') AS refused
      FROM place_intents WHERE requested_at_ms > ? GROUP BY place_ref ORDER BY posted DESC, place_ref`).all(since) as Row[])
      .map(row => ({ place: placeLabel(sidecar, String(row.place_ref)), posted: Number(row.posted ?? 0), refused: Number(row.refused ?? 0) }));
  }
  if (tableExists(sidecar, "home_ops")) {
    receipt.home = {
      changes: count(sidecar, "SELECT count(*) AS n FROM home_ops WHERE ok = 1 AND at_ms > ?", since),
      files: (sidecar.prepare(`SELECT DISTINCT path FROM home_ops WHERE ok = 1 AND op IN ('write','append') AND at_ms > ?
        ORDER BY path LIMIT 12`).all(since) as Row[]).map(row => String(row.path)),
    };
  }
  return receipt;
}

/** Plain lines for /status. */
export function renderLifeReceipt(receipt: LifeReceipt): string[] {
  const activities = Object.entries(receipt.ownTime.activities).map(([name, n]) => `${name} ${n}`).join(", ");
  const lines = [
    `Her week: ${receipt.ownTime.passes} own-time passes${activities ? ` (${activities})` : ""}, ${receipt.ownTime.spoke} reached out, ${receipt.night} nights`,
    `Read: ${receipt.reads.journal} passes with reads, ${receipt.reads.webRequests} web requests`,
    `Pursuits: ${receipt.pursuits.activeNow} active, ${receipt.pursuits.started} started, ${receipt.pursuits.touched} worked on, ${receipt.pursuits.finished} finished`,
  ];
  if (receipt.places.length) lines.push(`Places: ${receipt.places.map(place => `${place.place} ${place.posted} posted${place.refused ? `/${place.refused} refused` : ""}`).join(", ")}`);
  if (receipt.home.changes) lines.push(`Home: ${receipt.home.changes} changes${receipt.home.files.length ? ` (${receipt.home.files.join(", ")})` : ""}`);
  if (receipt.interests.lived.length || receipt.interests.new.length) {
    lines.push(`Interests: lived ${receipt.interests.lived.join(", ") || "none"}${receipt.interests.new.length ? `; new ${receipt.interests.new.join(", ")}` : ""}`);
  }
  return lines;
}
