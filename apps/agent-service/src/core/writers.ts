import type { DatabaseSync } from "node:sqlite";
import { createQuestion } from "./state/questions.js";
import { upsertFact } from "./memory/facts.js";

const PIN_RE =
  /^(?:bunu hatırla(?:\s+özel)?|remember(?:\s+this)?(?:\s+private)?)\s*[:：]\s*(.+)$/i;
const FORGET_RE = /^(?:unut|forget)\s*[:：]\s*(.+)$/i;
const OPEN_Q_RE =
  /\b(?:i(?:'m| am) (?:still )?(?:curious|wondering)|what do you think about|how do you feel about)\b/i;

/**
 * Normalize for departure matching: curly apostrophes → ASCII; strip delimited
 * double quotations only (never single-quoted spans that eat contractions).
 */
function normalizeDepartureText(message: string): string {
  return message
    .trim()
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/["“”][^"“”]*["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic owner absence/departure detector (sleep, AFK, brb, goodnight).
 * Not a model call. Rejects negations, interrogatives to others, and quotes.
 */
export function detectOwnerDepartureIntent(message: string): boolean {
  const raw = message.trim();
  if (!raw || raw.length > 280) return false;

  const text = normalizeDepartureText(raw);
  if (!text) return false;

  // Negations of sleep/departure.
  if (
    /\b(?:i(?:'m| am)? )?((?:not|never|wasn'?t|won'?t|will not|ain'?t) )+(?:\w+ ){0,3}(?:going to (?:bed|sleep)|sleeping|afk)\b/.test(
      text,
    ) ||
    /\bi wasn'?t going to sleep\b/.test(text)
  ) {
    return false;
  }

  // Interrogatives directed at Ashley or another person — not a global "?" veto.
  if (
    /\b(?:are you|will you|do you|did you)\b.{0,40}\b(?:going to (?:bed|sleep)|sleeping|afk|brb|good ?night)\b/.test(
      text,
    ) ||
    /\bshould (?:i|you)\b.{0,40}\b(?:go to (?:bed|sleep)|sleep|afk)\b/.test(text) ||
    /\b(?:will|is|are) (?:she|he|they)\b.{0,40}\b(?:sleeping|going to (?:bed|sleep)|afk)\b/.test(
      text,
    )
  ) {
    return false;
  }

  // Third-person or instructions to Ashley / others.
  if (
    /\b(?:you should|she is|he is|they are|someone is)\b.{0,40}\b(?:going to (?:bed|sleep)|sleeping|afk)\b/.test(
      text,
    ) ||
    /\b(?:you|she|he|they) (?:should|need to|ought to) go to (?:bed|sleep)\b/.test(text)
  ) {
    return false;
  }

  // Standalone short departure tokens (optional trailing punctuation).
  if (/^(?:gn|good ?night|afk|brb)[.!]*$/.test(text)) return true;

  // goodnight/gn as primary opening intent — trailing questions allowed.
  if (/^(?:good ?night|gn)\b/.test(text)) return true;

  // Direct first-person departure statements (trailing clauses/questions ok).
  if (
    /\bi(?:'m| am) going to (?:bed|sleep)\b/.test(text) ||
    /\bi(?:'ll| will) be sleeping\b/.test(text) ||
    /\bi(?:'m| am) going(?: to)? afk\b/.test(text) ||
    /\bi(?:'ll| will) be afk\b/.test(text) ||
    /\bi(?:'m| am) (?:gonna|going) (?:sleep|bed)\b/.test(text)
  ) {
    return true;
  }

  // "going to bed/sleep" with clear first-person cue and no foreign subject.
  if (
    /\bgoing to (?:bed|sleep)\b/.test(text) &&
    /\b(?:i(?:'m| am|'ll| will)|gonna)\b/.test(text) &&
    !/\b(?:you|she|he|they) (?:are|is|'re|'s)? (?:going|gonna)\b/.test(text)
  ) {
    return true;
  }

  // afk / brb as clear short presence change.
  if (/^(?:i(?:'m| am) )?(?:going )?(?:afk|brb)(?: for \w+)?[.!]*$/.test(text)) {
    return true;
  }

  return false;
}

/**
 * Persist durable state from a user turn. Heuristic writers — Agency consumes
 * whatever lands in nuclear.db.
 */
export function writeFromUserTurn(
  db: DatabaseSync,
  ownerId: string,
  message: string,
  sourceMessageId: number | null = null,
): {
  pinned: boolean;
  forgotTopic: string | null;
  departureSignal: boolean;
  /** @deprecated Alias of departureSignal. */
  sleepSignal: boolean;
} {
  const trimmed = message.trim();
  const pin = trimmed.match(PIN_RE);
  if (pin?.[1]) {
    const value = pin[1].trim();
    upsertFact(db, {
      ownerId,
      category: "pinned",
      key: value.slice(0, 80).toLowerCase().replace(/\s+/g, "_"),
      value,
      confidence: 1,
      importance: 90,
      origin: "manual",
      sourceMessageId,
    });
    return {
      pinned: true,
      forgotTopic: null,
      departureSignal: false,
      sleepSignal: false,
    };
  }

  const forget = trimmed.match(FORGET_RE);
  if (forget?.[1]) {
    return {
      pinned: false,
      forgotTopic: forget[1].trim(),
      departureSignal: false,
      sleepSignal: false,
    };
  }

  if (OPEN_Q_RE.test(trimmed) || /\?\s*$/.test(trimmed)) {
    const q = trimmed.replace(/\s+/g, " ").slice(0, 280);
    if (q.length >= 12) {
      createQuestion(db, {
        ownerId,
        subject: "about_doc",
        text: q,
        priority: 0.55,
      });
    }
  }

  const departureSignal = detectOwnerDepartureIntent(trimmed);
  return {
    pinned: false,
    forgotTopic: null,
    departureSignal,
    sleepSignal: departureSignal,
  };
}
