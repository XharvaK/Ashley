// Plain reading of how a finished act ended. The stored event keeps the game's finishing
// type; this never changes it. An unknown or missing type is cut short, never completed.

const COMPLETED = new Set(["NATURAL", "SI_FINISHED", "CONDITIONAL_EXIT", "AUTO_EXIT"]);

const CUT_SHORT: Readonly<Record<string, string>> = {
  INTERACTION_INCOMPATIBILITY: "something the game had to do first took its place",
  DISPLACED: "another action replaced it",
  PRIORITY: "something more urgent took its place",
  USER_CANCEL: "it was cancelled (by you or at the controls)",
  FAILED_TESTS: "the game decided it could not happen now",
  TRANSITION_FAILURE: "she could not get there or into position",
  OBJECT_CHANGED: "the object changed",
  RESET: "the game stopped it",
  KILLED: "the game stopped it",
  SOCIALS: "the conversation ended it",
  INTERACTION_QUEUE: "it waited in the queue and was dropped",
  WAIT_IN_LINE: "it waited in the queue and was dropped",
  SITUATIONS: "an event in the game ended it",
};

const EARLY = "the game ended it early";

// Probe 2.24.0 says whether the game ever began a pushed act. One it ended before it began is
// read from the game's own queue code: a queued act whose way there the game cannot find is
// ended as incompatible before it starts.
const NEVER_BEGAN: Readonly<Record<string, string>> = {
  INTERACTION_INCOMPATIBILITY: "it never began: the game found no way for her to do it from where she was",
};

export function endingOf(finishingType: unknown, started?: unknown): { ended: "completed" | "cut_short" | "asked" | "answered"; why?: string } {
  const name = typeof finishingType === "string"
    ? (finishingType.startsWith("FinishingType.") ? finishingType.slice("FinishingType.".length) : finishingType)
    : "";
  if (COMPLETED.has(name)) return { ended: "completed" };
  if (name === "ASKED") return { ended: "asked", why: "it opened the game's question; answering it is what starts the action" };
  if (name === "ANSWERED") return { ended: "answered" };
  if (started === false) return { ended: "cut_short", why: NEVER_BEGAN[name] ?? `it never began: ${CUT_SHORT[name] ?? EARLY}` };
  return { ended: "cut_short", why: CUT_SHORT[name] ?? EARLY };
}
