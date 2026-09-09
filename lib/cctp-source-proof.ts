import { ETHEREUM_SEPOLIA_RPC_URLS } from "./arc/config";

const APPROVAL_SELECTORS = ["0x095ea7b3", "0x39509351", "0xa457c2d7"];
export function isTokenApprovalData(data: string) {
  return APPROVAL_SELECTORS.some((selector) => data.toLowerCase().startsWith(selector));
}
export function cctpSourceFailure(receipt: { status?: string } | null, transaction: { input?: string } | null): string | null {
  if (receipt?.status === "0x0") return "The source transaction reverted. No CCTP transfer was completed.";
  if (receipt?.status === "0x1" && isTokenApprovalData(transaction?.input ?? "")) {
    return "Token approval confirmed, but this transaction is not a CCTP burn. No funds were bridged by this transaction. Use Recover CCTP to find a separately submitted burn.";
  }
  return null;
}
const RPC_URLS: Record<string, string[]> = {
  Base_Sepolia: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
  Arbitrum_Sepolia: ["https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia-rpc.publicnode.com"],
  Ethereum_Sepolia: ETHEREUM_SEPOLIA_RPC_URLS,
};
/** Only change a stuck record when the chain provides definite failure evidence. */
export async function checkCctpSourceFailure(chain: string, hash: string): Promise<string | null> {
  for (const url of RPC_URLS[chain] ?? []) {
    try {
      const [receipt, transaction] = await Promise.all(["eth_getTransactionReceipt", "eth_getTransactionByHash"].map(async (method) => {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [hash] }), cache: "no-store", signal: AbortSignal.timeout(6_000) });
        if (!response.ok) throw new Error("RPC unavailable");
        const payload = await response.json();
        if (payload.error) throw new Error("RPC unavailable");
        return payload.result;
      }));
      if (!receipt || !transaction) continue;
      return cctpSourceFailure(receipt, transaction);
    } catch { /* Provider outages are not transaction failures. */ }
  }
  return null;
}
