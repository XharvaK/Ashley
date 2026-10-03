import type { AdmissionTickResult } from "./admission.js";

const SKIP_FIELDS = [
  ["superseded", "skippedSuperseded"],
  ["secret", "skippedSecret"],
  ["unpublished", "skippedUnpublished"],
  ["generation", "skippedGeneration"],
  ["retracted", "skippedRetracted"],
  ["provenance", "skippedProvenance"],
] as const;

export function nominationCountForLog(nominations: readonly unknown[] | null | undefined): number {
  return nominations == null ? -1 : nominations.length;
}

export function formatMemorySettlementLine(settlementId: string, pass: string, nominations: number): string {
  return `[memory] settlement=${settlementId} pass=${pass} nominations=${nominations}`;
}

export function formatMemoryAdmissionLine(result: Pick<AdmissionTickResult, "considered" | "admitted" | "skippedSuperseded" | "skippedSecret" | "skippedUnpublished" | "skippedGeneration" | "skippedRetracted" | "skippedProvenance">): string {
  const skipped = SKIP_FIELDS
    .filter(([, field]) => result[field] > 0)
    .map(([reason, field]) => `${reason}:${result[field]}`)
    .join(",");
  return `[memory] admission considered=${result.considered} admitted=${result.admitted} skipped=${skipped}`;
}

export function logMemorySettlement(settlementId: string, pass: string, nominations: readonly unknown[] | null | undefined): void {
  console.log(formatMemorySettlementLine(settlementId, pass, nominationCountForLog(nominations)));
}

export function admissionTickFromResults(
  results: ReadonlyArray<{ result: string } | null>,
): Parameters<typeof formatMemoryAdmissionLine>[0] {
  const tick = {
    considered: results.length,
    admitted: 0,
    skippedSuperseded: 0,
    skippedSecret: 0,
    skippedUnpublished: 0,
    skippedGeneration: 0,
    skippedRetracted: 0,
    skippedProvenance: 0,
  };
  for (const item of results) {
    switch (item?.result) {
      case "admitted": tick.admitted += 1; break;
      case "admission_skipped_superseded": tick.skippedSuperseded += 1; break;
      case "admission_skipped_secret": tick.skippedSecret += 1; break;
      case "admission_skipped_unpublished": tick.skippedUnpublished += 1; break;
      case "admission_skipped_generation": tick.skippedGeneration += 1; break;
      case "admission_skipped_retracted": tick.skippedRetracted += 1; break;
      case "admission_skipped_provenance": tick.skippedProvenance += 1; break;
      default: break;
    }
  }
  return tick;
}

export function logMemoryAdmission(result: Parameters<typeof formatMemoryAdmissionLine>[0]): void {
  console.log(formatMemoryAdmissionLine(result));
}

export function logMemoryAdmissionError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`[memory] admission_error ${message}`);
}
