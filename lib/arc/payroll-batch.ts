import { keccak256, parseAbi, stringToHex, type Hex } from "viem";
import { ArcTestnet } from "@circle-fin/app-kit/chains";
import type { BrowserViemAdapter, CircleAdapter, MassPayout, MassPaymentResult } from "./app-kit-client";
import { ARC } from "./config";
import { wasPayrollMinted } from "./payroll-mint-proof";
import { parseUsdc, formatUsdc } from "../money";
import deployment from "../generated/payroll-router-deployment.json";

export const payrollAbi = parseAbi([
  "function executePayroll(bytes32 batchId, (address recipient,uint256 amount)[] payouts)",
  "function mintAndExecutePayroll(bytes32 batchId, (address recipient,uint256 amount)[] payouts, bytes attestation, bytes signature)",
  "function executedBatches(address employer,bytes32 batchId) view returns (bool success)",
  "function usdc() view returns (address account)",
  "function gatewayMinter() view returns (address account)",
  "event PayrollExecuted(address indexed employer, bytes32 indexed batchId, uint256 count, uint256 total)",
]);
export const tokenAbi = parseAbi(["function allowance(address owner,address spender) view returns (uint256 amount)", "function approve(address spender,uint256 amount) returns (bool success)"]);
type PendingRun = {
  id: Hex;
  manifest: Hex;
  funding: "arc_wallet" | "unified_balance";
  hash?: Hex;
  attestation?: Hex;
  signature?: Hex;
};
const memory = new Map<string, PendingRun>();
function readRun(key: string): PendingRun | undefined {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved);
  }
  return memory.get(key);
}
function saveRun(key: string, run: PendingRun) {
  // Persist before the wallet opens. A storage failure must stop execution.
  if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(run));
  memory.set(key, { ...run });
}
function clearRun(key: string) {
  if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  memory.delete(key);
}

/** One exact allowance and one atomic payout, including the Gateway mint when used. */
async function runPayrollBatch(
  adapter: BrowserViemAdapter,
  payouts: MassPayout[],
  spend?: (destination: CircleAdapter, owner: string, amount: string, retry?: { attestation: string; signature: string }) => Promise<unknown>,
): Promise<MassPaymentResult> {
  const router = deployment.address as Hex;
  if (!/^0x[0-9a-fA-F]{40}$/.test(router)) throw new Error("Payroll router is not deployed on Arc Testnet");
  await adapter.ensureChain(ArcTestnet);
  const owner = await adapter.getAddress(ArcTestnet);
  const rows = payouts
    .map(p => ({ recipient: p.recipientAddress.toLowerCase() as Hex, amount: parseUsdc(p.amount) }))
    .sort((left, right) => left.recipient < right.recipient ? -1 : left.recipient > right.recipient ? 1 : left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : 0);
  const total = rows.reduce((sum, p) => sum + p.amount, 0n);
  const funding: PendingRun["funding"] = spend ? "unified_balance" : "arc_wallet";
  const manifest = keccak256(stringToHex(JSON.stringify({
    router: router.toLowerCase(),
    payouts: rows.map(row => ({ recipient: row.recipient, amount: row.amount.toString() })),
  })));
  const key = `offgrid:payroll:v2:${owner.toLowerCase()}`;
  const pending = readRun(key);
  if ((pending?.attestation || pending?.hash) && (pending.manifest !== manifest || pending.funding !== funding)) {
    throw new Error("Finish or retry the pending payroll for this wallet before starting a different run");
  }
  const run: PendingRun = pending && pending.manifest === manifest && pending.funding === funding
    ? pending
    : { id: keccak256(stringToHex(crypto.randomUUID())), manifest, funding };
  saveRun(key, run);
  let submitted = Boolean(run.hash);
  try {
    const token = await adapter.readContract<string>({ address: router, abi: payrollAbi, functionName: "usdc", args: [] }, ArcTestnet);
    if (token.toLowerCase() !== ARC.contracts.usdc.toLowerCase()) throw new Error("Payroll router token does not match Arc USDC");
    const submit = async (args: unknown[], unified: boolean) => {
      const request = await adapter.prepare({ type: "evm", address: router, abi: payrollAbi, functionName: unified ? "mintAndExecutePayroll" : "executePayroll", args }, { chain: "Arc_Testnet" });
      return new Proxy(request, { get(target, property) {
        const member = Reflect.get(target, property, target);
        if (property === "execute") return async () => {
          const hash = await target.execute() as Hex;
          submitted = true;
          run.hash = hash;
          saveRun(key, run);
          return hash;
        };
        return typeof member === "function" ? member.bind(target) : member;
      } });
    };
    if (!run.hash) {
      const alreadyMinted = Boolean(spend && run.attestation && await wasPayrollMinted(adapter, run.attestation, owner, total));
      const allowance = await adapter.readContract<bigint>({ address: ARC.contracts.usdc, abi: tokenAbi, functionName: "allowance", args: [owner, router] }, ArcTestnet);
      if (allowance < total) {
        const approval = await adapter.prepare({ type: "evm", address: ARC.contracts.usdc, abi: tokenAbi, functionName: "approve", args: [router, total] }, { chain: "Arc_Testnet" });
        const hash = await approval.execute() as Hex;
        const receipt = await adapter.waitForTransaction(hash, { confirmations: 1, timeout: 120_000 }, ArcTestnet);
        if (receipt.status !== "success") throw new Error("USDC approval was not confirmed");
      }
      if (spend && !alreadyMinted) {
        const destination = new Proxy(adapter, { get(target, property) {
          const member = Reflect.get(target, property, target);
          if (property === "prepareAction") return async (action: string, params: { attestation: Hex; signature: Hex }, ...rest: unknown[]) => {
            if (action !== "gateway.v1.gatewayMint") return Reflect.apply(member, target, [action, params, ...rest]);
            run.attestation = params.attestation;
            run.signature = params.signature;
            saveRun(key, run);
            return submit([run.id, rows, params.attestation, params.signature], true);
          };
          return typeof member === "function" ? member.bind(target) : member;
        } });
        await spend(destination, owner, formatUsdc(total), run.attestation && run.signature ? { attestation: run.attestation, signature: run.signature } : undefined);
      } else {
        await (await submit([run.id, rows], false)).execute();
      }
    }
    if (!run.hash) throw new Error("Payroll was not submitted");
    const receipt = await adapter.waitForTransaction(run.hash, { confirmations: 1, timeout: 120_000 }, ArcTestnet);
    if (receipt.status !== "success") {
      delete run.hash;
      saveRun(key, run);
      throw new Error("Payroll reverted. No recipients were paid. Retry the same run.");
    }
    const executed = await adapter.readContract<boolean>({ address: router, abi: payrollAbi, functionName: "executedBatches", args: [owner, run.id] }, ArcTestnet);
    if (!executed) throw new Error("The payroll receipt has not been verified. Keep this run and retry confirmation.");
    // Receipt cardinality is not recipient cardinality: one hash covers every payout.
    const result: MassPaymentResult = { mode: spend ? "gateway_batch" : "router_batch", batchId: run.id, txHashes: payouts.map(() => run.hash!), explorerUrls: payouts.map(() => `${ARC.explorerUrl}/tx/${run.hash}`) };
    clearRun(key);
    return result;
  } catch (error) {
    if (!run.attestation && !run.hash && !submitted) clearRun(key);
    throw error;
  }
}

const runningWallets = new WeakSet<object>();
export async function executePayrollBatch(...args: Parameters<typeof runPayrollBatch>) {
  const adapter = args[0];
  if (runningWallets.has(adapter)) throw new Error("A payroll run is already being submitted with this wallet");
  runningWallets.add(adapter);
  try { return await runPayrollBatch(...args); }
  finally { runningWallets.delete(adapter); }
}
