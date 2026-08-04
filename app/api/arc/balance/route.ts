import { NextResponse } from "next/server";
import { createPublicClient, formatUnits, http, isAddress } from "viem";
import { arcTestnet } from "viem/chains";
import { ARC } from "@/lib/arc/config";
import { getCurrentUser } from "@/lib/server/auth";

const erc20BalanceAbi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "balance", type: "uint256" }],
}] as const;

export async function GET(request: Request) {
  if (!await getCurrentUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Invalid EVM wallet address" }, { status: 400 });

  try {
    // This read must not use the injected wallet transport: App Kit leaves the
    // wallet on the deposit source chain (for example Base Sepolia).
    const client = createPublicClient({
      chain: arcTestnet,
      transport: http(ARC.rpcUrl, { retryCount: 2, timeout: 12_000 }),
    });
    const rawBalance = await client.readContract({
      address: ARC.contracts.usdc,
      abi: erc20BalanceAbi,
      functionName: "balanceOf",
      args: [address],
    });
    return NextResponse.json({ balance: formatUnits(rawBalance, ARC.usdcDecimals) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Arc RPC did not return a balance";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
