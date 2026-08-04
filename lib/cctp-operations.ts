export type CctpOperationRecord = {
  burnTxHash: string | null;
  status: "awaiting_signature" | "attesting" | "minting" | "confirmed" | "failed";
  updatedAt: string;
};

export const UNSIGNED_CCTP_TTL_MS = 15 * 60 * 1_000;

/** A CCTP transfer becomes history only after its source-chain burn exists. */
export function isSubmittedCctpOperation(operation: Pick<CctpOperationRecord, "burnTxHash">) {
  return Boolean(operation.burnTxHash);
}

/**
 * Failed preflight/signature attempts are not transactions. A stale unsigned
 * placeholder can also be removed after a refresh/browser interruption.
 */
export function shouldPruneUnsignedCctpOperation(
  operation: CctpOperationRecord,
  now = Date.now(),
  ttlMs = UNSIGNED_CCTP_TTL_MS,
) {
  if (operation.burnTxHash) return false;
  if (operation.status === "failed") return true;
  return operation.status === "awaiting_signature"
    && (!Number.isFinite(Date.parse(operation.updatedAt)) || Date.parse(operation.updatedAt) < now - ttlMs);
}
