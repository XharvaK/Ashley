import type { ThoughtInput } from "../types.js";
import type { SoftLayerFacts } from "./acts.js";

/** What she sees of her soft layer: her recent soft acts, her wardrobe, and her quiet window's facts. */
export type SoftLayerView = SoftLayerFacts & {
  quiet?: {
    refused?: NonNullable<ThoughtInput["quietRefusal"]>;
    held?: NonNullable<ThoughtInput["heldWhileQuiet"]>;
    ownerPresence?: NonNullable<ThoughtInput["ownerPresence"]>;
  };
};

/**
 * W1 kept the quiet facts on the input but no projection carried them to the
 * model; they travel here, beside her soft acts.
 */
export function softLayerView(input: Pick<ThoughtInput, "softLayer" | "quietRefusal" | "heldWhileQuiet" | "ownerPresence">): SoftLayerView | undefined {
  const quiet = {
    ...(input.quietRefusal ? { refused: input.quietRefusal } : {}),
    ...(input.heldWhileQuiet ? { held: input.heldWhileQuiet } : {}),
    ...(input.ownerPresence ? { ownerPresence: input.ownerPresence } : {}),
  };
  const view: SoftLayerView = {
    ...(input.softLayer?.acts?.length ? { acts: input.softLayer.acts } : {}),
    ...(input.softLayer?.face ? { face: input.softLayer.face } : {}),
    ...(Object.keys(quiet).length ? { quiet } : {}),
  };
  return Object.keys(view).length ? view : undefined;
}
