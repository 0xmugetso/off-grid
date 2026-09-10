import { describe, it, expect, vi } from 'vitest';
import { concatHex, toHex, padHex, type Hex } from 'viem';
import { payrollSpecHashes, wasPayrollMinted } from '../lib/arc/payroll-mint-proof';
import type { BrowserViemAdapter } from '../lib/arc/app-kit-client';
const owner='0x2222222222222222222222222222222222222222';
const minter='0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';
const token='0x3600000000000000000000000000000000000000';
function attestation(amount:bigint,recipient=owner,salt=1):Hex {
 const spec=concatHex(['0xca85def7',toHex(1,{size:4}),toHex(6,{size:4}),toHex(26,{size:4}),padHex(owner),padHex(minter),padHex(token),padHex(token),padHex(owner),padHex(recipient as Hex),padHex(owner),toHex(0,{size:32}),toHex(amount,{size:32}),toHex(salt,{size:32}),toHex(0,{size:4})]);
 return concatHex(['0xff6fb334',toHex(999999999,{size:32}),toHex((spec.length-2)/2,{size:4}),spec]);
}
describe('Gateway payroll recovery proof',()=>{
 it('accepts exact single and multi-source mint proofs',()=>{
  expect(payrollSpecHashes(attestation(4000000n),owner,4000000n)).toHaveLength(1);
  const set=concatHex(['0x1e12db71',toHex(2,{size:4}),attestation(1250000n),attestation(2750000n,owner,2)]);
  expect(payrollSpecHashes(set,owner,4000000n)).toHaveLength(2);
 });
 it('rejects another recipient, wrong total, truncated or trailing bytes',()=>{
  expect(()=>payrollSpecHashes(attestation(4n,minter),owner,4n)).toThrow();
  expect(()=>payrollSpecHashes(attestation(4n),owner,5n)).toThrow();
  expect(()=>payrollSpecHashes('0xff6fb334',owner,4n)).toThrow();
  expect(()=>payrollSpecHashes(concatHex([attestation(4n),'0x00']),owner,4n)).toThrow();
 });
 it('requires confirmed minter replay state before falling back to wallet payout',async()=>{
  const readContract=vi.fn().mockResolvedValue(false);const adapter={readContract} as unknown as BrowserViemAdapter;
  expect(await wasPayrollMinted(adapter,attestation(4n),owner,4n)).toBe(false);
  readContract.mockResolvedValue(true);
  expect(await wasPayrollMinted(adapter,attestation(4n),owner,4n)).toBe(true);
  readContract.mockRejectedValue(new Error('RPC offline'));
  await expect(wasPayrollMinted(adapter,attestation(4n),owner,4n)).rejects.toThrow('RPC offline');
 });
});
