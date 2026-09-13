export const CANONICAL_WITNESS_BYTES: string;
export const CANONICAL_WITNESS_LENGTH: number;
export const CANONICAL_WITNESS_SHA256: string;
export function assertSafePath(targetPath: string, description: string): void;
export function verifyCanonicalWitnessHash(): boolean;
export function runSubstrateQualification(options?: any): Promise<any>;
