# Fiat sandbox setup

OffGrid's fiat rail uses Circle Mint sandbox for provider-shaped bank simulation and a pre-funded developer-controlled settlement wallet for the final Arc Testnet transfer. Every completed fiat-to-Web3 session contains a Circle wire reference, a Circle deposit ID, a developer wallet transaction ID, and a verified testnet transaction hash.

## What the sandbox can test

Circle Mint exposes production-shaped APIs at `https://api-sandbox.circle.com`. It can simulate bank account linking, wire deposits, balances, USDC deposits, redemption payout creation, status polling, failures, idempotency, and notifications. It does not send money to a real bank account.

## What you need to provide

1. A Circle developer sandbox account with Circle Mint access.
2. A sandbox API key stored as `CIRCLE_MINT_API_KEY`.
3. A sandbox wire bank account created in Circle Mint, with its ID stored as `CIRCLE_MINT_BANK_ACCOUNT_ID`.
4. A dedicated developer-controlled SCA wallet on Arc Testnet. Store its values as `CIRCLE_SETTLEMENT_WALLET_ID` and `CIRCLE_SETTLEMENT_WALLET_ADDRESS`. The existing escrow agent wallet may be reused for a limited hackathon test.
5. Fund the settlement wallet with Arc Testnet USDC from the Circle faucet. Keep the balance small and disposable.
6. Set `PAYMENT_SESSION_SANDBOX_MAX_USD` to a small amount such as `10`.
7. Configure Circle Wallets notifications at `https://YOUR_DOMAIN/api/webhooks/circle`. The participant views also reconcile status by polling.

Copy `.env.example` to `.env.local`, fill the Circle Mint API key and wire bank account ID, optionally add a webhook secret, restart the dev server, then check `GET /api/fiat/status` while signed in.

## Fiat to Web3 proof sequence

1. The payer starts a clearly labeled simulated bank payment. No card or bank account is charged.
2. Circle creates a sandbox mock wire and returns a tracking reference.
3. OffGrid queries Circle's deposit API until it finds the matching tracking reference, amount, timestamp, and a `complete` deposit status. It persists the unique Circle deposit ID and resulting master balance.
4. The pre-funded developer-controlled settlement wallet sends real Arc Testnet USDC to the receiver's bound wallet.
5. OffGrid persists the Circle Wallets transaction ID and waits for Circle to report it complete.
6. OffGrid independently reads the Arc Testnet receipt and verifies the expected USDC `Transfer` event, amount, source, destination, block number, and block hash.
7. Both participants receive the same invoice with the final ArcScan transaction.

This is a sponsor-funded product demonstration. Circle's deposit record proves the sandbox bank simulation. The Arc receipt proves the testnet payout. The two liquidity pools are intentionally separate, so this must never be described as a real user bank payment or production conversion. The amount cap limits abuse of the funded test wallet.

## Web3 to fiat proof sequence

1. OffGrid requests or reuses the Circle Mint business account's Arc USDC deposit address.
2. The payer signs an exact Arc Testnet USDC transfer from the wallet bound to their account.
3. OffGrid independently verifies the successful receipt and matching USDC `Transfer` event before accepting the transaction hash.
4. OffGrid polls Circle Mint until its inbound transfer record matches the transaction hash and amount and reaches `complete`.
5. OffGrid creates a Circle Mint sandbox wire payout to `CIRCLE_MINT_BANK_ACCOUNT_ID` and persists its provider payout ID.
6. OffGrid polls the payout until Circle reports `complete`, then stores the tracking reference and creates the shared invoice.

The payer transfer is real testnet USDC. The bank payout is a Circle sandbox simulation. The interface shows both facts and keeps the Arc transaction hash, Circle inbound transfer ID, Circle payout ID, payout status, and bank tracking reference as separate proofs.

## Proofs persisted for every completed session

- Circle mock wire tracking reference and submission status
- Circle business-account deposit ID, amount, status, tracking reference, and timestamps
- Circle Mint balance after the confirmed sandbox deposit
- Developer settlement wallet address and its balance before payout
- Circle Wallets transaction ID and terminal state
- Arc Testnet transaction hash, block number, and block hash
- Independent verification that the USDC transfer log matches the expected sender, receiver, and amount

A UI label never advances settlement. Every completed stage is backed by a provider response stored in the payment session record. The final invoice is created only after the onchain receipt passes verification.

## Receiving fiat in sandbox

Do not collect or prefill fake personal IBAN or cardholder details. The interface selects the configured platform-owned sandbox bank destination and states that no real fiat moves. A production payout requires KYC or KYB, sanctions screening, a participant-owned verified bank account, encrypted payout profiles, and provider approval.

## Creating the sandbox wire account

Run `npm run circle:create-wire-account` after setting `CIRCLE_MINT_API_KEY`. The helper calls Circle Mint's sandbox wire-account endpoint and prints the returned `bankAccountId` so you can paste it into `CIRCLE_MINT_BANK_ACCOUNT_ID`.

If you want to override the default sandbox wire details, set these optional env vars before running the helper:

- `CIRCLE_MINT_WIRE_ACCOUNT_NUMBER`
- `CIRCLE_MINT_WIRE_ROUTING_NUMBER`
- `CIRCLE_MINT_WIRE_BILLING_NAME`
- `CIRCLE_MINT_WIRE_BILLING_LINE1`
- `CIRCLE_MINT_WIRE_BILLING_LINE2`
- `CIRCLE_MINT_WIRE_BILLING_CITY`
- `CIRCLE_MINT_WIRE_BILLING_COUNTRY`
- `CIRCLE_MINT_WIRE_BILLING_DISTRICT`
- `CIRCLE_MINT_WIRE_BILLING_POSTAL_CODE`
- `CIRCLE_MINT_WIRE_BANK_NAME`
- `CIRCLE_MINT_WIRE_BANK_LINE1`
- `CIRCLE_MINT_WIRE_BANK_LINE2`
- `CIRCLE_MINT_WIRE_BANK_CITY`
- `CIRCLE_MINT_WIRE_BANK_COUNTRY`
- `CIRCLE_MINT_WIRE_BANK_DISTRICT`

## Required production work

A platform cannot safely reuse one bank account ID for end users. Production requires participant KYC/KYB, sanctions screening, ownership-verified and encrypted payout profiles, jurisdiction and rail eligibility, provider terms/approval, idempotent jobs, webhook signature verification, double-entry accounting, and reconciliation. The current client never collects raw bank credentials.
