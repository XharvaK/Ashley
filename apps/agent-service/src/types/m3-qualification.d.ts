declare module "*m3-substrate-qualification.mjs" {
  export const CANONICAL_WITNESS_BYTES: string;
  export const CANONICAL_WITNESS_LENGTH: number;
  export const CANONICAL_WITNESS_SHA256: string;
  export function assertSafePath(targetPath: string, description: string): void;
  export function verifyCanonicalWitnessHash(): { length: number; sha256: string };
  export function runSubstrateQualification(options?: any): Promise<any>;
}

declare module "*m3-qualification-contract.mjs" {
  export const CANONICAL_WITNESS_BYTES: string;
  export const CANONICAL_WITNESS_LENGTH: number;
  export const CANONICAL_WITNESS_SHA256: string;
  export function toCanonicalPosixRoot(path: string): string;
  export function assertSafePath(targetPath: string, description: string): void;
  export function verifyCanonicalWitnessHash(): { length: number; sha256: string };
}
