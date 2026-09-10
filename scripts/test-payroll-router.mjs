import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import solc from 'solc';
import { createPublicClient, createWalletClient, http, keccak256, stringToHex } from 'viem';
import { foundry } from 'viem/chains';
const transport = http(process.env.PAYROLL_TEST_RPC || 'http://127.0.0.1:8547');
const publicClient = createPublicClient({ chain: foundry, transport });
const wallet = createWalletClient({ chain: foundry, transport });
const [owner, first, second, attacker] = await wallet.getAddresses();
const mocks = `pragma solidity ^0.8.24;
contract Token {
 mapping(address=>uint256) public balanceOf;
 mapping(address=>mapping(address=>uint256)) public allowance;
 address public blocked;
 event Transfer(address indexed from,address indexed to,uint256 value);
 function blockRecipient(address a) external { blocked=a; }
 function mint(address a,uint256 n) external { balanceOf[a]+=n; }
 function approve(address a,uint256 n) external returns(bool) { allowance[msg.sender][a]=n; return true; }
 function transferFrom(address a,address b,uint256 n) external returns(bool) { require(b!=blocked); allowance[a][msg.sender]-=n; balanceOf[a]-=n; balanceOf[b]+=n; emit Transfer(a,b,n); return true; }
}
contract Minter { Token token; address owner; uint256 amount; bool public used;
 constructor(Token t,address o,uint256 a) { token=t; owner=o; amount=a; }
 function gatewayMint(bytes calldata,bytes calldata) external { require(!used); used=true; token.mint(owner,amount); }
}`;
const compiled = JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'PayrollRouter.sol':{content:readFileSync('contracts/PayrollRouter.sol','utf8')},'Mocks.sol':{content:mocks}},settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}), {import:p=>({contents:readFileSync('node_modules/'+p,'utf8')})}));
assert(!compiled.errors?.some(e=>e.severity==='error'), JSON.stringify(compiled.errors));
async function deploy(file,name,args=[]) { const a=compiled.contracts[file][name]; const hash=await wallet.deployContract({account:owner,abi:a.abi,bytecode:'0x'+a.evm.bytecode.object,args}); const r=await publicClient.waitForTransactionReceipt({hash}); assert.equal(r.status,'success'); return {address:r.contractAddress,abi:a.abi}; }
async function write(c,functionName,args=[],account=owner) { const hash=await wallet.writeContract({...c,functionName,args,account,gas:3000000n}); return publicClient.waitForTransactionReceipt({hash}); }
async function read(c,functionName,args=[]) {return publicClient.readContract({...c,functionName,args});}
const token=await deploy('Mocks.sol','Token'); const minter=await deploy('Mocks.sol','Minter',[token.address,owner,4000000n]); const router=await deploy('PayrollRouter.sol','PayrollRouter',[token.address,minter.address]);
const payouts=[{recipient:first,amount:1250000n},{recipient:second,amount:2750000n}]; const id=n=>keccak256(stringToHex(n));
await write(token,'mint',[owner,4000000n]); await write(token,'approve',[router.address,4000000n]);
assert.equal((await write(router,'executePayroll',[id('direct'),payouts])).status,'success');
assert.equal(await read(token,'balanceOf',[first]),1250000n); assert.equal(await read(token,'balanceOf',[second]),2750000n); assert.equal(await read(token,'allowance',[owner,router.address]),0n);
assert.equal((await write(router,'executePayroll',[id('direct'),payouts])).status,'reverted');
await write(token,'approve',[router.address,4000000n]); await write(token,'blockRecipient',[second]);
assert.equal((await write(router,'mintAndExecutePayroll',[id('gateway'),payouts,'0x01','0x02'])).status,'reverted');
assert.equal(await read(minter,'used'),false); assert.equal(await read(token,'balanceOf',[first]),1250000n); assert.equal(await read(token,'balanceOf',[owner]),0n);
await write(token,'blockRecipient',['0x0000000000000000000000000000000000000000']);
assert.equal((await write(router,'mintAndExecutePayroll',[id('gateway'),payouts,'0x01','0x02'],attacker)).status,'reverted');
assert.equal(await read(minter,'used'),false);
assert.equal((await write(router,'mintAndExecutePayroll',[id('gateway'),payouts,'0x01','0x02'])).status,'success');
assert.equal(await read(token,'balanceOf',[first]),2500000n); assert.equal(await read(token,'balanceOf',[second]),5500000n); assert.equal(await read(token,'balanceOf',[router.address]),0n);
assert.equal((await write(router,'executePayroll',[id('empty'),[]])).status,'reverted');
assert.equal((await write(router,'executePayroll',[id('large'),Array(51).fill(payouts[0])])).status,'reverted');
console.log('PASS: unequal payouts, exact allowance, duplicate prevention, atomic mint rollback, unauthorized caller, successful mint + payouts, empty/oversized batches.');
