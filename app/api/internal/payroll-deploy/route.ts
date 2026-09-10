import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { initiateSmartContractPlatformClient, type Blockchain } from "@circle-fin/smart-contract-platform";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import artifact from "@/lib/generated/payroll-router-artifact.json";
export const runtime = "nodejs";
export const maxDuration = 60;
const authorizedHash = "03a4891716342919413ed4db4e75a475cf75bf1daef3258e3a6ba077aa9ceaee";
const expires = 1789127900338;
export async function POST(request: Request) {
 const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
 const hash = createHash("sha256").update(supplied).digest("hex");
 if (Date.now() > expires || !timingSafeEqual(Buffer.from(hash), Buffer.from(authorizedHash))) return new NextResponse(null,{status:404});
 try {
  const apiKey=process.env.CIRCLE_API_KEY ?? "";
  const entitySecret=process.env.CIRCLE_ENTITY_SECRET ?? "";
  const walletId=process.env.CIRCLE_ESCROW_AGENT_WALLET_ID ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(entitySecret)) throw new Error("Hosted entity secret has an invalid format");
  const wallets=initiateDeveloperControlledWalletsClient({apiKey,entitySecret});
  const contracts=initiateSmartContractPlatformClient({apiKey,entitySecret});
  const wallet=(await wallets.getWallet({id:walletId})).data?.wallet;
  if(String(wallet?.blockchain)!=="ARC-TESTNET") throw new Error("Deployment wallet must be on Arc Testnet");
  const deployment=await contracts.deployContract({
   idempotencyKey:"c3f4e37a-c947-48b5-9382-92fef6f9413a", name:"OffGridPayrollRouter",description:"Atomic USDC payroll and composed Circle Gateway mint on Arc Testnet",
   walletId, blockchain:"ARC-TESTNET" as Blockchain,fee:{type:"level",config:{feeLevel:"MEDIUM"}},
   constructorParameters:["0x3600000000000000000000000000000000000000","0x0022222ABE238Cc2C7Bb1f21003F0a260052475B"],
   abiJson:JSON.stringify(artifact.abi),bytecode:artifact.bytecode
  });
  const {contractId,transactionId}=deployment.data ?? {};
  if(!contractId || !transactionId) throw new Error("No deployment identifiers returned");
  for(let i=0;i<15;i++){
   const tx=(await wallets.getTransaction({id:transactionId})).data?.transaction;
   const contract=(await contracts.getContract({id:contractId})).data?.contract;
   if(tx?.state==="FAILED") throw new Error("Deployment transaction failed");
   if(contract?.contractAddress && tx?.txHash) return NextResponse.json({address:contract.contractAddress,transactionHash:tx.txHash,chainId:5042002});
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  return NextResponse.json({status:"pending",contractId,transactionId},{status:202});
 } catch(error) {
  const e=error as {response?:{data?:{code?:number;message?:string}},message?:string};
  return NextResponse.json({error:e.response?.data?.message ?? "Deployment could not complete",code:e.response?.data?.code},{status:400});
 }
}
