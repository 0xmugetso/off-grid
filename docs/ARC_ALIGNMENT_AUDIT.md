# OffGrid × Arc alignment audit

Audited against the current Arc `llms.txt`, Arc network references, App Kit Unified Balance and Bridge quickstarts, and the official ERC-8183 job quickstart on 2026-08-09.

## Current alignment

| Area | Status | Evidence in OffGrid |
| --- | --- | --- |
| Arc Testnet network | Aligned | Chain ID `5042002`, `https://rpc.testnet.arc.io`, USDC currency, ArcScan explorer, and Circle faucet are configured in `lib/arc/config.ts`. |
| Arc USDC units | Aligned | Application transfers use the 6-decimal ERC-20 interface at `0x3600000000000000000000000000000000000000`; native gas is treated separately. |
| Browser EVM wallets | Aligned | EIP-6963 discovery, explicit wallet account request, adapter creation, and Arc chain switching follow the browser-wallet quickstart. |
| Unified Balance deposits | Aligned | App Kit `unifiedBalance.deposit` is used with explicit source chain selection for EVM and Solana. |
| Unified Balance reads | Aligned with browser-wallet model | `getBalances({ sources, networkType: "testnet", includePending: true })` is used. Pending and confirmed balances are displayed separately. |
| Unified Balance spends | Aligned with browser-wallet model | App Kit `unifiedBalance.spend` targets `Arc_Testnet`; route estimation, retryable mint recovery, and receipt persistence are implemented. |
| CCTP bridge | Aligned at the App Kit abstraction | App Kit `bridge` is used instead of manually orchestrating burn, attestation, and mint. Source burns and recoverable state are persisted. |
| Solana Devnet | Aligned with the current App Kit quickstart | Solana adapter and authenticated RPC proxy are used; source deposits are separate from EVM wallet operations. |
| Arc gas | Partially aligned | Arc uses USDC-native gas, but the UI does not yet expose a live fee estimate/max-fee explanation before every direct contract operation. |
| Fiat | Intentionally sandbox-only | Circle Mint sandbox requests and webhooks are clearly labeled; no claim is made that fiat reaches a real bank. |

## Critical mismatch: escrow

The current AI Escrow tab is a functional OffGrid-specific contract flow, but it is **not the exact Arc ERC-8183 sample flow**:

- OffGrid deploys `contracts/RefundProtocol.sol` dynamically through Circle Smart Contract Platform.
- The current Arc ERC-8183 quickstart uses the predeployed AgenticCommerce reference implementation at `0x0747EEf0706327138c69792bF28Cd525089e4583`.
- Official lifecycle: `createJob`, `setBudget`, `fund`, provider `submit(bytes32 deliverable)`, evaluator `complete(bytes32 reason)`, then read `getJob`.
- OffGrid lifecycle: deploy custom RefundProtocol, approve/pay, upload image, AI validation, `withdraw` or `refund`.

The current flow is valid as a custom escrow product, but it should not be presented as “the exact official ERC-8183 flow.” The next migration should either:

1. Replace the custom contract path with the official AgenticCommerce/ERC-8183 adapter and preserve the existing visual design; or
2. Keep RefundProtocol as an OffGrid extension and label it clearly as “OffGrid RefundProtocol,” while adding a separate “Arc ERC-8183” mode.

The safer product decision is option 2 until the official contract’s evaluator, hook, expiry, and job-state semantics are mapped into the existing database and UI.

## Testnet acceptance matrix

Use a fresh wallet/account pair and small amounts. Every test should end with an ArcScan or source-chain explorer URL shown in the UI.

### Direct Arc transfer

1. Connect an EVM wallet and switch to Arc Testnet.
2. Request Arc USDC from the Circle faucet.
3. Send `0.01` USDC to a second Arc wallet.
4. Confirm the ERC-20 transfer and receipt on ArcScan.

### Unified Balance

1. Fund Base Sepolia USDC and native testnet gas.
2. Deposit from Base Sepolia and wait for `pending → confirmed`.
3. Optionally connect Solana Devnet, fund USDC and SOL, and deposit from Solana.
4. Confirm each source breakdown and the aggregate confirmed balance.
5. Spend `0.01` USDC to an Arc recipient and verify the destination hash.
6. Force a refresh during pending mint; confirm the saved retry remains available and no duplicate spend is submitted.

### CCTP bridge

1. Fund a supported source chain with USDC and native source gas.
2. Select CCTP, confirm the source chain and Arc destination.
3. Sign once, then verify the source burn hash.
4. Refresh while attesting/minting.
5. Confirm the Arc mint and that History contains source burn, attestation, mint, and final receipt.

### Escrow (current custom mode)

1. Register two OffGrid wallet users.
2. Create an agreement and upload a document.
3. Confirm AI-extracted amount/tasks/criteria before creation.
4. Deploy RefundProtocol, fund it with the Circle SCA wallet, and verify the contract transaction.
5. Submit image evidence as the beneficiary.
6. Confirm AI validation, withdrawal/refund transaction, and audit log.

### Fiat sandbox

1. Configure Circle Mint sandbox API key and wire account ID.
2. Create a sandbox payout and verify the provider payout ID/status.
3. Trigger the sandbox webhook and confirm History updates.
4. Verify that the UI says “sandbox” and never represents the result as a real bank transfer.

## Required user-facing test guidance

The app should expose a compact “Testnet checklist” panel, not static fake stats. It should show:

- Connected wallet and current chain.
- Required source-chain gas and USDC.
- Confirmed vs pending Gateway balance.
- Current protocol and exact next action.
- Explorer links for every submitted transaction.
- Explicit sandbox labels for fiat.
- A separate badge for custom OffGrid RefundProtocol versus official ERC-8183 mode.

## Sources

- [Arc documentation index](https://docs.arc.io/llms.txt)
- [Arc network connection and chain details](https://docs.arc.io/arc/references/connect-to-arc)
- [Arc contract addresses and USDC model](https://docs.arc.io/arc/references/contract-addresses)
- [Unified Balance quickstart](https://docs.arc.io/app-kit/quickstarts/unified-balance-deposit-and-spend)
- [Bridge quickstart](https://docs.arc.io/app-kit/quickstarts/bridge-tokens-across-blockchains)
- [Arc ERC-8183 job quickstart](https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job)
