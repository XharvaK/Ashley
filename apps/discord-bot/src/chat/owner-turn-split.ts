/** The agent refuses an ingress message over 4000 characters; parts stay under this so a joined turn is never rejected. */
export const OWNER_TURN_TEXT_LIMIT = 3_900;

export type OwnerTurnPart = { text: string; ids: string[] };

/** Cuts text into pieces of at most limit units, never ending a piece on a high surrogate. */
function pieces(text: string, limit: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && end - 1 > start && last >= 0xd800 && last <= 0xdbff) end -= 1;
    out.push(text.slice(start, end));
    start = end;
  }
  return out.length > 0 ? out : [""];
}

/**
 * Packs Owner fragments into parts the agent accepts. Fragments are joined with a newline, as before.
 * A fragment that is too long on its own is cut, and only its first cut carries the Discord id.
 */
export function splitOwnerTurn(
  fragments: ReadonlyArray<{ text: string; id: string }>,
  limit: number = OWNER_TURN_TEXT_LIMIT,
): OwnerTurnPart[] {
  const out: OwnerTurnPart[] = [];
  const add = (piece: string, id: string | null): void => {
    const last = out.at(-1);
    if (last && last.text.length + 1 + piece.length <= limit) {
      last.text += `\n${piece}`;
      if (id) last.ids.push(id);
      return;
    }
    out.push({ text: piece, ids: id ? [id] : [] });
  };
  for (const fragment of fragments) {
    pieces(fragment.text, limit).forEach((piece, index) => add(piece, index === 0 ? fragment.id : null));
  }
  return out;
}
