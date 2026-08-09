# OffGrid

OffGrid is a testnet payment product built on Arc and Circle App Kit. Users create persistent local accounts, open private two-party payment sessions, negotiate Web3 USDC or fiat preferences, settle supported Web3 agreements, and share a transaction-backed receipt.

## Private payment sessions

1. A creator chooses **pay** or **receive**, their preferred rail, the amount, and a memo.
2. OffGrid generates a 256-bit random invite capability and stores only its SHA-256 hash. Session URLs contain no editable payment terms or sequential identifiers.
3. The first different authenticated account to accept the invite becomes its counterparty. After it is claimed, all unrelated accounts receive `403`.
4. The counterparty chooses their own rail. The server derives payer and receiver from the creator's direction and locks the session.
5. Web3-to-Web3 sessions open the existing App Kit console with recipient, amount, and memo read-only. The payer still chooses Arc wallet, Gateway, or CCTP as the USDC source.
6. Invoice creation validates the session again, including payer identity, both rails, receiver wallet, and amount, then atomically marks the session complete. Both participants see the same receipt.

Fiat combinations can be agreed but cannot execute until Circle Mint sandbox is configured. See [docs/FIAT_SANDBOX.md](docs/FIAT_SANDBOX.md).

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev -- -p 3001
```

Open [http://localhost:3001](http://localhost:3001).

Use a unique `SESSION_SECRET` in `.env.local`. Local development stores account records and invoices in `.data/offgrid.json` with file mode `0600`; when `DATABASE_URL`, `POSTGRES_URL`, or `POSTGRES_URL_NON_POOLING` is configured, the same store boundary uses hosted Postgres instead. See [docs/VERCEL_DEPLOYMENT.md](docs/VERCEL_DEPLOYMENT.md) before deploying.

## Real testnet flow

1. Create an OffGrid account. Passwords are scrypt-hashed and the signed session is stored in an HttpOnly cookie.
2. Connect an injected wallet selected through EIP-6963 discovery.
3. Add/switch to Arc Testnet from the product. Chain ID is `5042002`; native gas is USDC.
4. Request Arc testnet USDC from the in-product Circle Faucet link.
5. Refresh the wallet balance. OffGrid reads the 6-decimal USDC ERC-20 interface directly from Arc RPC.
6. Optionally connect a Solana browser wallet, then deposit USDC from Base Sepolia, Arbitrum Sepolia, Ethereum Sepolia, Solana Devnet, or Arc into Circle Gateway using `kit.unifiedBalance.deposit`.
7. Find another wallet-bound OffGrid user by username, or paste an EVM address.
8. Choose one live route:
   - Arc wallet: `kit.estimateSend` then `kit.send`.
   - Gateway: `kit.unifiedBalance.estimateSpend` then `spend`; App Kit automatically allocates confirmed deposits across supported chains.
   - CCTP V2: bridge from Base Sepolia, Arbitrum Sepolia, Ethereum Sepolia, or Solana Devnet to Arc with `kit.estimateBridge` then `kit.bridge`, using Circle Forwarder for the destination mint.
9. CCTP uses hard-finality standard transfer mode. OffGrid persists the operation and source burn hash, then polls Circle's sandbox Iris API every eight seconds. Refreshing or starting another transaction does not discard the transfer state.
10. Circle Forwarder completes the Arc mint without keeping the destination wallet flow open. A confirmed forwarder mint creates the invoice automatically; History uses that Arc mint transaction as its canonical proof.

## Mass payment

- Build a roster from wallet-bound OffGrid accounts, single EVM addresses, or a bulk `name, wallet, amount` import.
- Equal allocation applies one amount to every recipient; custom allocation validates every six-decimal USDC amount independently.
- **Arc wallet:** OffGrid prepares one USDC ERC-20 transfer per recipient with the Circle Viem adapter. Wallets advertising EIP-5792 atomic batching receive one `wallet_sendCalls` request; other wallets use an explicit sequential fallback.
- **Unified Balance:** App Kit executes one documented Gateway `spend` per recipient. This is guided but not atomic, and Gateway fees can apply.
- A run is capped at 50 unique recipients. Receipts are stored only for transaction hashes returned by the wallet or Gateway.
- The existing `PayrollRouter.sol` remains an unused prototype. Browser-wallet mass payment does not require a custom custody contract.

## Commands

```bash
npm test
npm run typecheck
npm run build
```

## Honest integration boundaries

- Arc and Gateway paths are live testnet calls authorized by the connected wallet.
- The EVM adapter declares Base Sepolia, Arbitrum Sepolia, Ethereum Sepolia, and Arc Testnet. Solana Devnet uses Circle's separate browser-wallet adapter, as required by the official App Kit flow.
- Bank/fiat payout is disabled until licensed provider credentials and compliance workflows are configured. The UI does not fake a completed bank payout.
- AI Escrow is currently a participant-scoped proof record. It requires real Arc transaction hashes and does not custody funds or submit releases until an audited escrow contract is deployed.
- The local JSON store is suitable for local product testing, not multi-instance production. Replace it with PostgreSQL, encrypted payout profiles, KMS-managed secrets, idempotent jobs, and a double-entry ledger before deployment.
- `contracts/PayrollRouter.sol` remains an unaudited prototype and is not used for custody.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system boundaries and production requirements.
