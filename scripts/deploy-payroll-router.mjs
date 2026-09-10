import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { initiateSmartContractPlatformClient } from '@circle-fin/smart-contract-platform';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, http } from 'viem';
import { arcTestnet } from 'viem/chains';
// Never print an SDK error object: it can contain authenticated request headers.
process.on('uncaughtException', (error) => {
  const payload = error?.response?.data;
  console.error('Payroll deployment failed:', payload?.code ?? '', payload?.message ?? error.message);
  process.exit(1);
});
const config = { apiKey: process.env.CIRCLE_API_KEY, entitySecret: process.env.CIRCLE_ENTITY_SECRET };
const walletId = process.env.CIRCLE_ESCROW_AGENT_WALLET_ID;
if (!config.apiKey || !config.entitySecret || !walletId) throw new Error('Circle deployment wallet is not configured');
if (!/^[a-fA-F0-9]{64}$/.test(config.entitySecret)) throw new Error('CIRCLE_ENTITY_SECRET must be the original 64-character hexadecimal secret; the local value has an invalid format.');
const contracts = initiateSmartContractPlatformClient(config);
const wallets = initiateDeveloperControlledWalletsClient(config);
const artifact = JSON.parse(await readFile('lib/generated/payroll-router-artifact.json', 'utf8'));
const client = createPublicClient({ chain: arcTestnet, transport: http('https://rpc.testnet.arc.io') });
const statePath = '/tmp/offgrid-payroll-deployment-state.json';
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch {}
if (!state) {
  const wallet = (await wallets.getWallet({ id: walletId })).data?.wallet;
  if (wallet?.blockchain !== 'ARC-TESTNET') throw new Error('Deployment wallet must be on Arc Testnet');
  state = { idempotencyKey: randomUUID() };
  await writeFile(statePath, JSON.stringify(state));
}
if (!state.contractId) {
  const result = await contracts.deployContract({
    idempotencyKey: state.idempotencyKey, name: 'OffGridPayrollRouter',
    description: 'Atomic USDC payroll and composed Circle Gateway mint on Arc Testnet',
    walletId, blockchain: 'ARC-TESTNET', fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    constructorParameters: ['0x3600000000000000000000000000000000000000', '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B'],
    abiJson: JSON.stringify(artifact.abi), bytecode: artifact.bytecode,
  });
  state = { ...state, ...result.data };
  await writeFile(statePath, JSON.stringify(state));
}
for (let i = 0; i < 60; i++) {
  const tx = (await wallets.getTransaction({ id: state.transactionId })).data?.transaction;
  if (tx?.state === 'FAILED') throw new Error('Payroll deployment failed');
  const c = (await contracts.getContract({ id: state.contractId })).data?.contract;
  if (c?.contractAddress && tx?.txHash) {
    const receipt = await client.getTransactionReceipt({ hash: tx.txHash });
    if (receipt.status !== 'success') throw new Error('Deployment reverted');
    const address = c.contractAddress;
    const token = await client.readContract({ address, abi: artifact.abi, functionName: 'usdc' });
    const minter = await client.readContract({ address, abi: artifact.abi, functionName: 'gatewayMinter' });
    if (token.toLowerCase() !== '0x3600000000000000000000000000000000000000' || minter.toLowerCase() !== '0x0022222abe238cc2c7bb1f21003f0a260052475b') throw new Error('Unexpected router configuration');
    await writeFile('lib/generated/payroll-router-deployment.json', JSON.stringify({ chainId: 5042002, address, transactionHash: tx.txHash }, null, 2) + '\n');
    console.log('Verified Arc Testnet payroll router:', address, tx.txHash);
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
throw new Error('Deployment still pending; rerun to resume the same deployment');
