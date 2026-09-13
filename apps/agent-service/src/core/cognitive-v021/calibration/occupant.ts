import type { OccupantCalibration, OccupantId } from "../types.js";

/** Per-occupant operational notes. It is deliberately separate from Identity and Memory. */
export class OccupantCalibrationStore {
  private occupantId: OccupantId;
  private notes: string[] = [];

  constructor(occupantId: OccupantId) {
    if (!occupantId.trim()) throw new Error("occupant_id_required");
    this.occupantId = occupantId;
  }

  get(): OccupantCalibration {
    return { occupantId: this.occupantId, notes: [...this.notes] };
  }

  addNote(note: string): OccupantCalibration {
    const clean = note.trim();
    if (clean) this.notes = [...new Set([...this.notes, clean])];
    return this.get();
  }

  clear(): OccupantCalibration {
    this.notes = [];
    return this.get();
  }

  swap(occupantId: OccupantId): OccupantCalibration {
    if (!occupantId.trim()) throw new Error("occupant_id_required");
    if (occupantId !== this.occupantId) {
      this.occupantId = occupantId;
      this.notes = [];
    }
    return this.get();
  }
}

export function createOccupantCalibrationStore(occupantId: OccupantId): OccupantCalibrationStore {
  return new OccupantCalibrationStore(occupantId);
}
