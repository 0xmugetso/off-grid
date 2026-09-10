import { keccak256, parseAbi, sliceHex, size, type Hex } from "viem";
import { ArcTestnet } from "@circle-fin/app-kit/chains";
import type { BrowserViemAdapter } from "./app-kit-client";
import { ARC } from "./config";
const MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const abi = parseAbi(["function isTransferSpecHashUsed(bytes32 transferSpecHash) view returns (bool)"]);

/** Circle's canonical Attestation/AttestationSet and TransferSpec byte encodings. */
export function payrollSpecHashes(payload: Hex, owner: string, total: bigint): Hex[] {
  const length = size(payload);
  const field = (start: number, end: number) => {
    if (start < 0 || end > length) throw new Error("Truncated Gateway attestation");
    return sliceHex(payload, start, end);
  };
  const number = (start: number, end: number) => Number(BigInt(field(start, end)));
  const magic = field(0, 4);
  const set = magic === "0x1e12db71";
  if (!set && magic !== "0xff6fb334") throw new Error("Unsupported Gateway attestation encoding");
  const count = set ? number(4, 8) : 1;
  if (!count || count > 16) throw new Error("Invalid Gateway attestation count");
  let offset = set ? 8 : 0;
  let sum = 0n;
  const hashes: Hex[] = [];
  for (let i = 0; i < count; i++) {
    if (field(offset, offset + 4) !== "0xff6fb334") throw new Error("Invalid Gateway attestation");
    const specLength = number(offset + 36, offset + 40);
    const start = offset + 40;
    const end = start + specLength;
    if (specLength < 340 || end > length || field(start, start + 4) !== "0xca85def7") throw new Error("Invalid Gateway transfer specification");
    const address = (at: number) => {
      if (BigInt(field(start + at, start + at + 12)) !== 0n) throw new Error("Invalid EVM address encoding");
      return field(start + at + 12, start + at + 32).toLowerCase();
    };
    if (number(start + 4, start + 8) !== 1 || number(start + 12, start + 16) !== ARC.cctpDomain || address(48) !== MINTER.toLowerCase() || address(112) !== ARC.contracts.usdc.toLowerCase() || address(176) !== owner.toLowerCase()) throw new Error("Gateway mint does not match this payroll wallet");
    if (340 + number(start + 336, start + 340) !== specLength) throw new Error("Invalid Gateway hook length");
    sum += BigInt(field(start + 272, start + 304));
    hashes.push(keccak256(field(start, end)));
    offset = end;
  }
  if (offset !== length || sum !== total || new Set(hashes).size !== hashes.length) throw new Error("Gateway mint does not match the payroll total");
  return hashes;
}

/** Only used specs prove that Circle already minted the exact total to this payer. */
export async function wasPayrollMinted(adapter: BrowserViemAdapter, payload: Hex, owner: string, total: bigint) {
  const hashes = payrollSpecHashes(payload, owner, total);
  const used = await Promise.all(hashes.map(hash => adapter.readContract<boolean>({ address: MINTER, abi, functionName: "isTransferSpecHashUsed", args: [hash] }, ArcTestnet)));
  if (used.some(Boolean) && !used.every(Boolean)) throw new Error("Gateway payroll mint is incomplete; retain this run for recovery");
  return used.every(Boolean);
}
