import { parseAbi, type EIP1193Provider } from 'viem';
import { describe,it,expect } from 'vitest';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import { ArcTestnet } from '@circle-fin/app-kit/chains';
import { payrollAbi,tokenAbi } from '../lib/arc/payroll-batch';
import { ARC } from '../lib/arc/config';
const owner='0x2222222222222222222222222222222222222222';
describe('real Circle adapter payroll ABI validation',()=>{
 it('prepares total approval and both payout calls without signing',async()=>{
  const adapter=await createViemAdapterFromProvider({provider:{on:()=>{},removeListener:()=>{},request:(async ({method}:{method:string})=>{
   if(method==='eth_accounts'||method==='eth_requestAccounts')return [owner];
   if(method==='eth_chainId')return '0x4cef52';
   throw new Error('Unexpected provider call: '+method);
  }) as EIP1193Provider['request']},capabilities:{supportedChains:[ArcTestnet]}});
  await expect(adapter.prepare({type:'evm',address:ARC.contracts.usdc,abi:parseAbi(['function approve(address spender,uint256 amount) returns (bool)']),functionName:'approve',args:[owner,2500000n]},{chain:'Arc_Testnet'})).rejects.toThrow('outputs.0.name');
  const batch='0x'+'11'.repeat(32);
  const payouts=[{recipient:owner,amount:2500000n}];
  for(const [abi,functionName,args] of [[tokenAbi,'approve',[owner,2500000n]],[payrollAbi,'executePayroll',[batch,payouts]],[payrollAbi,'mintAndExecutePayroll',[batch,payouts,'0x12','0x34']]] as const){
   const request=await adapter.prepare({type:'evm',address:ARC.contracts.usdc,abi,functionName,args:[...args]},{chain:'Arc_Testnet'});
   expect(request).toBeDefined();
  }
 });
});
