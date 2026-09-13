import type { AuthorityCode } from "../types.js";
import type { RelationalConstraintView } from "../memory/views.js";

export type InjectedRelationalConstraintRows = {
  neverMention?: string[];
  withdrawalActive?: boolean;
};

/** Build only the structured constraint view. No relationship narrator is produced. */
export function buildInjectedRelationalConstraintView(
  rows: InjectedRelationalConstraintRows,
): RelationalConstraintView {
  return {
    assertions: [],
    neverMention: [...new Set((rows.neverMention ?? []).map((value) => value.trim()).filter(Boolean))],
    withdrawalActive: rows.withdrawalActive === true,
  };
}

export function relationalBoundaryCodes(
  draft: string,
  view: Pick<RelationalConstraintView, "neverMention">,
): AuthorityCode[] {
  const lower = draft.toLowerCase();
  return view.neverMention.some((term) => term && lower.includes(term.toLowerCase()))
    ? ["RELATIONAL_BOUNDARY"]
    : [];
}

export const buildRelationalConstraintInput = buildInjectedRelationalConstraintView;
