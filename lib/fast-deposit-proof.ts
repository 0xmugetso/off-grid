import { decodeEventLog, parseAbi } from "viem";
import { ARC } from "./arc/config";
import { parseUsdc } from "./money";
const WALLET = "0x0077777d7eba4688bdef3e311b846f25870a19b9";
const ABI = parseAbi(["event Deposited(address indexed token, address indexed depositor, address indexed sender, uint256 value)"]);
export function verifiesGatewayCredit(receipt: { status?: string; logs?: Array<{ address: string; data: string; topics: string[] }> } | null, account: string, amount: string) {
  if (receipt?.status !== "0x1") return false;
  return receipt.logs?.some((log) => {
    if (log.address.toLowerCase() !== WALLET) return false;
    try {
      const { args } = decodeEventLog({ abi: ABI, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      return args.token.toLowerCase() === ARC.contracts.usdc.toLowerCase() && args.depositor.toLowerCase() === account.toLowerCase() && args.value === parseUsdc(amount);
    } catch { return false; }
  }) ?? false;
}

const TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
export function verifiesUsdcDelivery(receipt: Parameters<typeof verifiesGatewayCredit>[0], recipient: string, amount: string) {
  if (receipt?.status !== "0x1") return false;
  return receipt.logs?.some((log) => {
    if (log.address.toLowerCase() !== ARC.contracts.usdc.toLowerCase()) return false;
    try {
      const { args } = decodeEventLog({ abi: TRANSFER_ABI, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      return args.to.toLowerCase() === recipient.toLowerCase() && args.value === parseUsdc(amount);
    } catch { return false; }
  }) ?? false;
}
export async function verifyArcDelivery(hash: string, recipient: string, amount: string) {
  try {
    const response = await fetch(ARC.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }), cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return false;
    const payload = await response.json();
    return verifiesUsdcDelivery(payload.result, recipient, amount);
  } catch { return false; }
}
