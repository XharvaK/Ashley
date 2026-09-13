import type { DatabaseSync } from "node:sqlite";
import {
  insertItem,
  listSources,
  markSourceFetched,
  parseFeed,
  upsertSource,
  urlKey,
} from "./feed.js";
import {
  fetchValidatedResource,
  type FetchLike,
  type ResolveHost,
} from "./network.js";

type Candidate = {
  id: number;
  url: string;
  title: string;
  kind: "rss" | "atom" | "json";
  interest: string;
  status: "proposed" | "probation";
  successfulFetches: number;
};

export const SOURCE_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;

function sourceIsDue(lastFetchedAt: string | null, nowMs: number): boolean {
  if (!lastFetchedAt) return true;
  const fetchedAtMs = Date.parse(lastFetchedAt);
  return !Number.isFinite(fetchedAtMs) || fetchedAtMs <= nowMs - SOURCE_SCAN_INTERVAL_MS;
}

export async function scanConfiguredSources(
  db: DatabaseSync,
  dependencies: { fetcher?: FetchLike; resolve?: ResolveHost } = {},
  now = new Date(),
): Promise<{ sourcesFetched: number; itemsInserted: number; errors: string[] }> {
  const sources = listSources(db, 200)
    .filter((source) => source.kind === "rss" || source.kind === "atom")
    .filter((source) => sourceIsDue(source.lastFetchedAt, now.getTime()))
    .slice(0, 6);
  let sourcesFetched = 0;
  let itemsInserted = 0;
  const errors: string[] = [];
  for (const source of sources) {
    sourcesFetched++;
    try {
      const resource = await fetchValidatedResource(source.url, {
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
        ...dependencies,
      });
      if (resource.contentType && !/(?:rss|atom|xml)/i.test(resource.contentType)) {
        throw new Error("unsupported_feed_content_type");
      }
      const parsed = parseFeed(new TextDecoder("utf-8", { fatal: false }).decode(resource.body), 3);
      if (parsed.length === 0) throw new Error("feed_parse_empty");
      let insertedForSource = 0;
      for (const item of parsed) {
        if (insertItem(db, {
          sourceId: source.id,
          url: item.url,
          title: item.title,
          excerpt: item.excerpt,
          interest: source.interest,
          publishedAt: item.publishedAt,
          score: source.weight,
        }) !== null) insertedForSource++;
      }
      markSourceFetched(db, source.id, null);
      itemsInserted += insertedForSource;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      try { markSourceFetched(db, source.id, message); } catch { /* preserve the scan failure */ }
      errors.push(`source:${source.id}:${message}`);
    }
  }
  return { sourcesFetched, itemsInserted, errors };
}

export async function processSourceProbation(
  db: DatabaseSync,
  dependencies: { fetcher?: FetchLike; resolve?: ResolveHost } = {},
): Promise<{ activated: number; probationSuccesses: number; errors: string[] }> {
  const rows = db.prepare(
    `SELECT id, url, title, kind, interest, status, successful_fetches
     FROM cur_source_candidates
     WHERE status IN ('proposed', 'probation')
       AND provenance = 'live'
     ORDER BY successful_fetches DESC, id ASC LIMIT 6`,
  ).all() as Array<Record<string, unknown>>;
  const candidates: Candidate[] = rows.map((row) => ({
    id: Number(row.id),
    url: String(row.url),
    title: String(row.title),
    kind: row.kind === "atom" || row.kind === "json" ? row.kind : "rss",
    interest: String(row.interest),
    status: row.status === "probation" ? "probation" : "proposed",
    successfulFetches: Number(row.successful_fetches ?? 0),
  }));
  const existingKeys = new Set(listSources(db, 200).map((source) => urlKey(source.url)));
  let activated = 0;
  let probationSuccesses = 0;
  const errors: string[] = [];
  for (const candidate of candidates) {
    const key = urlKey(candidate.url);
    if (existingKeys.has(key)) {
      db.prepare(
        `UPDATE cur_source_candidates SET status = 'rejected', last_error = 'duplicate', updated_at = ?
         WHERE id = ?`,
      ).run(new Date().toISOString(), candidate.id);
      continue;
    }
    try {
      const resource = await fetchValidatedResource(candidate.url, {
        accept: "application/rss+xml, application/atom+xml, application/json, text/xml;q=0.9",
        ...dependencies,
      });
      const finalKey = urlKey(resource.finalUrl);
      if (existingKeys.has(finalKey) && finalKey !== key) {
        db.prepare(
          `UPDATE cur_source_candidates SET status = 'rejected', last_error = 'redirect_duplicate', updated_at = ?
           WHERE id = ?`,
        ).run(new Date().toISOString(), candidate.id);
        continue;
      }
      const parsed = parseFeed(new TextDecoder().decode(resource.body), 3);
      if (parsed.length === 0) throw new Error("feed_parse_empty");
      const successes = candidate.successfulFetches + 1;
      const canActivate = successes >= 3 && listSources(db, 200).length < 100;
      db.prepare(
        `UPDATE cur_source_candidates
         SET status = ?, successful_fetches = ?, last_error = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(canActivate ? "active" : "probation", successes, new Date().toISOString(), candidate.id);
      probationSuccesses++;
      if (canActivate) {
        upsertSource(db, {
          slug: `discovered-${candidate.id}`,
          title: candidate.title,
          kind: candidate.kind,
          url: resource.finalUrl,
          interest: candidate.interest,
          weight: 0.5,
        });
        existingKeys.add(finalKey);
        activated++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare(
        `UPDATE cur_source_candidates
         SET status = 'probation', last_error = ?, updated_at = ? WHERE id = ?`,
      ).run(message.slice(0, 500), new Date().toISOString(), candidate.id);
      errors.push(`candidate:${candidate.id}:${message}`);
    }
  }
  return { activated, probationSuccesses, errors };
}
