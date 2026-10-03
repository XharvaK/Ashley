import type { DatabaseSync } from "node:sqlite";
import type { ThoughtInnerAgenda } from "../types.js";
import { listLiveMemoryAssertions, REDACTED_MEMORY_STATEMENT } from "../memory/assertions.js";
import { listRecentEpisodes, toThoughtEpisode } from "../memory/episodes.js";
import { INTEREST_ROOTS, listInterestBranches } from "../memory/interests.js";
import { UNSOLICITED_FUSE_LIMIT, countUnsolicited, recentUnsolicited } from "./reach-out.js";
import type { AwakePass } from "./inner-pass.js";
import { recordInfluencedAgendaOrder, type InfluenceAgendaContext } from "../influences/agenda.js";
import { latestChosenGap } from "../growth/dimensions.js";

/**
 * Growth V1 §5.3: the inner agenda for an AWAKE pass.
 *
 * The Host gathers; it chooses nothing. Due self-scheduled triggers, active
 * concerns, and subscription items already reach Thought through the
 * ordinary input; this adds what only an inner pass needs.
 */

export const AGENDA_EPISODES_LIMIT = 8;
export const AGENDA_THREADS_LIMIT = 10;
export const AGENDA_QUESTIONS_LIMIT = 10;
export const AGENDA_BRANCHES_LIMIT = 16;
const OPEN_THREADS_WINDOW_MS = 7 * 24 * 60 * 60_000;

export function buildInnerAgenda(db: DatabaseSync, pass: AwakePass, nowMs: number, influenceContext?: InfluenceAgendaContext): ThoughtInnerAgenda {
  const episodes = listRecentEpisodes(db, 40).filter((episode) => episode.dataClassification !== "secret");
  const episodesSince = episodes
    .filter((episode) => episode.endedAtMs > pass.sinceMs)
    .slice(0, AGENDA_EPISODES_LIMIT)
    .reverse()
    .map(toThoughtEpisode);
  const unresolvedThreads = [...new Set(episodes
    .filter((episode) => episode.endedAtMs >= nowMs - OPEN_THREADS_WINDOW_MS)
    .flatMap((episode) => episode.unresolvedThreads))]
    .slice(0, AGENDA_THREADS_LIMIT);
  const openQuestions = listLiveMemoryAssertions(db)
    .filter((assertion) => assertion.memoryKind === "open_question"
      && assertion.statement !== REDACTED_MEMORY_STATEMENT
      && (!assertion.audienceScope || assertion.audienceScope.kind === "owner_private"))
    .slice(0, AGENDA_QUESTIONS_LIMIT)
    .map((assertion) => ({ key: assertion.assertionKey, statement: assertion.statement }));
  const originalBranches = listInterestBranches(db, nowMs, AGENDA_BRANCHES_LIMIT);
  const orderedBranches = influenceContext ? recordInfluencedAgendaOrder(db, originalBranches, influenceContext, nowMs) : originalBranches;
  const branches = orderedBranches.map((branch) => ({
    root: branch.root,
    branch: branch.label,
    strength: branch.strength,
    lastLivedAtMs: branch.lastLivedAtMs,
    ...(branch.lastNote ? { note: branch.lastNote } : {}),
  }));
  const chosen = latestChosenGap(db);
  return {
    lastAwakeAtMs: pass.sinceMs > 0 ? pass.sinceMs : null,
    episodesSince,
    unresolvedThreads,
    openQuestions,
    interests: { roots: [...INTEREST_ROOTS], branches },
    reachOut: {
      unsolicitedLast24h: countUnsolicited(db, nowMs),
      fuseLimit: UNSOLICITED_FUSE_LIMIT,
      recent: recentUnsolicited(db),
    },
    ...(chosen ? { chosenGap: { id: chosen.id, name: chosen.name, question: chosen.question } } : {}),
  };
}
