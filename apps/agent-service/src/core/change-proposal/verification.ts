import type { TestReceiptRef, VerifyStatus } from "./types.js";

export type BrokerReceiptEvidence = {
  brokerState: string;
  exitCode?: number;
  recipeId: string;
  receiptArtifactHash: string;
  storedArtifactHash: string;
};

export function deriveVerified(evidence: BrokerReceiptEvidence): {
  verified: boolean;
  verifyStatus: VerifyStatus;
} {
  if (evidence.brokerState === "unsupported") {
    return { verified: false, verifyStatus: "unsupported" };
  }
  if (
    evidence.brokerState !== "succeeded" ||
    evidence.exitCode !== 0 ||
    evidence.receiptArtifactHash !== evidence.storedArtifactHash
  ) {
    return { verified: false, verifyStatus: "failed" };
  }
  return { verified: true, verifyStatus: "succeeded" };
}

export function attachSystemReceipt(
  refs: TestReceiptRef[],
  receipt: TestReceiptRef,
): TestReceiptRef[] {
  if (receipt.verified && receipt.verifyStatus === "succeeded") {
    const derived = deriveVerified({
      brokerState: "succeeded",
      exitCode: 0,
      recipeId: receipt.recipeId ?? "",
      receiptArtifactHash: receipt.contentHash ?? "",
      storedArtifactHash: receipt.contentHash ?? "",
    });
    receipt = { ...receipt, verified: derived.verified, verifyStatus: derived.verifyStatus };
  }
  return [...refs.filter((item) => item.taskId !== receipt.taskId), receipt];
}
