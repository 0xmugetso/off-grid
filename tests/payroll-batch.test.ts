import { describe, it, expect, vi } from "vitest";
vi.mock('../lib/generated/payroll-router-deployment.json', () => ({ default: { address: '0x1111111111111111111111111111111111111111' } }));
const { wasPayrollMinted } = vi.hoisted(() => ({ wasPayrollMinted: vi.fn() }));
vi.mock('../lib/arc/payroll-mint-proof', () => ({ wasPayrollMinted }));
import { executePayrollBatch } from '../lib/arc/payroll-batch';
import { ARC } from '../lib/arc/config';
import type { BrowserViemAdapter, CircleAdapter } from '../lib/arc/app-kit-client';
function setup() {
  wasPayrollMinted.mockReset().mockResolvedValue(false);
  const hash = '0x' + 'ab'.repeat(32);
  const prepare = vi.fn(async (params) => ({ execute: vi.fn(async () => hash), getCallData: () => params }));
  const adapter = {
    ensureChain: vi.fn(), getAddress: vi.fn(async () => '0x2222222222222222222222222222222222222222'),
    readContract: vi.fn(async (p) => p.functionName === 'usdc' ? ARC.contracts.usdc : p.functionName === 'executedBatches' ? true : 0n),
    waitForTransaction: vi.fn(async () => ({status:'success'})), prepare,
  };
  return { adapter: adapter as unknown as BrowserViemAdapter, prepare, wait: adapter.waitForTransaction };
}
const rows = (amount:string) => [{recipientAddress:'0x3333333333333333333333333333333333333333',amount}, {recipientAddress:'0x4444444444444444444444444444444444444444',amount:'2.75'}];
describe('atomic payroll orchestration', () => {
 it('uses one exact approval and one transaction for unequal recipients', async () => {
  const {adapter,prepare}=setup();
  const result=await executePayrollBatch(adapter,rows('1.25'));
  expect(prepare.mock.calls.map(([p])=>p.functionName)).toEqual(['approve','executePayroll']);
  expect(prepare.mock.calls[0][0].args[1]).toBe(4000000n);
  expect(result.txHashes).toHaveLength(2); expect(new Set(result.txHashes).size).toBe(1);
 });
 it('keeps approval and transaction counts constant for 50 recipients', async () => {
  const {adapter,prepare}=setup();
  const recipients=Array.from({length:50},(_,i)=>({recipientAddress:'0x'+(i+100).toString(16).padStart(40,'0'),amount:'1'}));
  const result=await executePayrollBatch(adapter,recipients);
  expect(prepare.mock.calls.map(([p])=>p.functionName)).toEqual(['approve','executePayroll']);
  expect(prepare.mock.calls[0][0].args[1]).toBe(50000000n);
  expect(result.txHashes).toHaveLength(50);
  expect(new Set(result.txHashes).size).toBe(1);
 });
 it('skips the approval when the existing total allowance is sufficient', async () => {
  const {adapter,prepare}=setup();
  vi.mocked(adapter.readContract).mockImplementation(async (p) => p.functionName === 'usdc' ? ARC.contracts.usdc : p.functionName === 'executedBatches' ? true : 100000000n);
  await executePayrollBatch(adapter,rows('8.25'));
  expect(prepare.mock.calls.map(([p])=>p.functionName)).toEqual(['executePayroll']);
 });
 it('composes a single Gateway mint and all payouts, retaining SDK attestation', async () => {
  const {adapter,prepare}=setup();
  const spend=vi.fn(async (dest:CircleAdapter,owner:string,amount:string) => {
   expect(owner).toMatch(/^0x222/); expect(amount).toBe('5.00');
   const request=await dest.prepareAction('gateway.v1.gatewayMint' as never,{attestation:'0x12',signature:'0x34'} as never,{chain:'Arc_Testnet'} as never);
   await request.execute();
  });
  await executePayrollBatch(adapter,rows('2.25'),spend);
  expect(spend).toHaveBeenCalledTimes(1);
  expect(prepare.mock.calls.map(([p])=>p.functionName)).toEqual(['approve','mintAndExecutePayroll']);
  expect(prepare.mock.calls[1][0].args.slice(2)).toEqual(['0x12','0x34']);
 });
 it('resumes a submitted hash after timeout without another approval or payout', async () => {
  const {adapter,prepare,wait}=setup();
  const original=[
   {recipientAddress:'0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',amount:'3.25'},
   {recipientAddress:'0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',amount:'2.75'},
  ];
  wait.mockResolvedValueOnce({status:'success'}).mockRejectedValueOnce(new Error('timeout'));
  await expect(executePayrollBatch(adapter,original)).rejects.toThrow('timeout');
  prepare.mockClear();
  await executePayrollBatch(adapter,[
   {recipientAddress:'0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',amount:'2.750000'},
   {recipientAddress:'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',amount:'3.250000'},
  ]);
  expect(prepare).not.toHaveBeenCalled();
 });
 it('retries the existing attestation after wallet rejection without another Gateway transfer', async () => {
  const {adapter}=setup(); let retrySeen:unknown;
  await expect(executePayrollBatch(adapter,rows('4.25'),async (dest) => {
   await dest.prepareAction('gateway.v1.gatewayMint' as never,{attestation:'0x56',signature:'0x78'} as never,{chain:'Arc_Testnet'} as never);
   throw new Error('Wallet rejected');
  })).rejects.toThrow('Wallet rejected');
  await executePayrollBatch(adapter,rows('4.25'),async (dest,_owner,_amount,retry) => {
   retrySeen=retry;
   const p=await dest.prepareAction('gateway.v1.gatewayMint' as never,retry as never,{chain:'Arc_Testnet'} as never); await p.execute();
  });
  expect(retrySeen).toEqual({attestation:'0x56',signature:'0x78'});
 });
 it('locks the wallet to an unresolved attested manifest and funding mode', async () => {
  const {adapter}=setup();
  await expect(executePayrollBatch(adapter,rows('5.25'),async (dest) => {
   await dest.prepareAction('gateway.v1.gatewayMint' as never,{attestation:'0x9a',signature:'0xbc'} as never,{chain:'Arc_Testnet'} as never);
   throw new Error('Wallet rejected');
  })).rejects.toThrow('Wallet rejected');
  const anotherSpend=vi.fn();
  await expect(executePayrollBatch(adapter,rows('6.25'),anotherSpend)).rejects.toThrow('Finish or retry the pending payroll');
  await expect(executePayrollBatch(adapter,rows('5.25'))).rejects.toThrow('Finish or retry the pending payroll');
  expect(anotherSpend).not.toHaveBeenCalled();

  await executePayrollBatch(adapter,rows('5.25'),async (dest,_owner,_amount,retry) => {
   const request=await dest.prepareAction('gateway.v1.gatewayMint' as never,retry as never,{chain:'Arc_Testnet'} as never);
   await request.execute();
  });
 });
 it('clears a rejected run when no attestation or payroll hash was issued', async () => {
  const {adapter}=setup();
  await expect(executePayrollBatch(adapter,rows('7.25'),async () => {
   throw new Error('Rejected before submission');
  })).rejects.toThrow('Rejected before submission');

  await expect(executePayrollBatch(adapter,rows('8.25'),async (dest) => {
   const request=await dest.prepareAction('gateway.v1.gatewayMint' as never,{attestation:'0xde',signature:'0xf0'} as never,{chain:'Arc_Testnet'} as never);
   await request.execute();
  })).resolves.toMatchObject({mode:'gateway_batch'});
 });
 it('uses the original batch id without another Gateway spend when its attestation was already minted', async () => {
  const {adapter,prepare}=setup();
  await expect(executePayrollBatch(adapter,rows('9.25'),async (dest) => {
   await dest.prepareAction('gateway.v1.gatewayMint' as never,{attestation:'0x1234',signature:'0x5678'} as never,{chain:'Arc_Testnet'} as never);
   throw new Error('Lost after mint');
  })).rejects.toThrow('Lost after mint');
  const originalBatchId=prepare.mock.calls.find(([p])=>p.functionName === 'mintAndExecutePayroll')?.[0].args[0];
  prepare.mockClear();
  wasPayrollMinted.mockResolvedValueOnce(true);
  const spend=vi.fn();

  const result=await executePayrollBatch(adapter,rows('9.25'),spend);

  expect(wasPayrollMinted).toHaveBeenCalledWith(adapter,'0x1234','0x2222222222222222222222222222222222222222',12000000n);
  expect(spend).not.toHaveBeenCalled();
  expect(prepare.mock.calls.map(([p])=>p.functionName)).toEqual(['approve','executePayroll']);
  expect(prepare.mock.calls[1][0].args[0]).toBe(originalBatchId);
  expect(result.mode).toBe('gateway_batch');
 });
});
