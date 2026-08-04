export const EVM_TRANSACTION_HASH = /^0x[a-fA-F0-9]{64}$/;
export const SOLANA_TRANSACTION_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

export function isTransactionHash(value: string) {
  return EVM_TRANSACTION_HASH.test(value) || SOLANA_TRANSACTION_SIGNATURE.test(value);
}

export function isSourceTransactionHash(chain: string, value: string) {
  return chain === "Solana_Devnet" ? SOLANA_TRANSACTION_SIGNATURE.test(value) : EVM_TRANSACTION_HASH.test(value);
}
