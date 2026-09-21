import type { ProjectedThoughtInput } from "./projection.js";
import type { ThoughtInput } from "../types.js";
import type { ConcernInspectDependencies } from "./source-currentness.js";

export type ConcernInspectAuthority = Readonly<{
  refs: ReadonlySet<string>;
  expectations: ConcernInspectDependencies;
}>;

const EMPTY: ConcernInspectDependencies = Object.freeze({});

export function concernInspectRefsFor(
  expectations: ConcernInspectDependencies | undefined,
): ConcernInspectAuthority {
  const owned = expectations ?? EMPTY;
  return {
    refs: new Set(Object.keys(owned)),
    expectations: owned,
  };
}

export function concernInspectRefsForInput(
  input: ThoughtInput | ProjectedThoughtInput,
): ConcernInspectAuthority {
  const direct = (input as { concernInspectDependencies?: ConcernInspectDependencies }).concernInspectDependencies;
  return concernInspectRefsFor(direct && typeof direct === "object" ? direct : undefined);
}
