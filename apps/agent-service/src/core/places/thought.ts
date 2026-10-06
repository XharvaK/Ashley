// What an Owner-private turn reads about her places (A1) and her acts there (B1).
import type { DatabaseSync } from "node:sqlite";
import { placesForThought, type ThoughtPlace } from "./places.js";
import { recentPlaceActs, type PlaceAct } from "./intents.js";
import { webPlacesForThought, type WebPlaceView } from "../reach/web.js";

export type ThoughtPlaces = { list: ThoughtPlace[]; acts?: PlaceAct[]; web?: WebPlaceView[] };

export function thoughtPlaces(sidecar: DatabaseSync, nuclear: DatabaseSync, input: {
  nowMs: number; here?: "owner_dm"; game?: { world: string; live: boolean }; vaultDir?: string;
}): ThoughtPlaces | undefined {
  try {
    const list = placesForThought(sidecar, nuclear, input);
    const acts = recentPlaceActs(sidecar, input.nowMs);
    const web = webPlacesForThought(sidecar, input.vaultDir, input.nowMs);
    return { list, ...(acts.length ? { acts } : {}), ...(web.length ? { web } : {}) };
  } catch {
    return undefined;
  }
}
