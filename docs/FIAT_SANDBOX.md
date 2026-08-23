# Fiat sandbox setup

OffGrid's fiat rail uses Circle Mint sandbox for provider-shaped bank simulation and a developer-controlled settlement wallet for the final Arc Testnet transfer. Every completed fiat-to-Web3 session contains a Circle wire reference, a Circle transfer ID, a developer wallet transaction ID, and a testnet transaction hash.

## What the sandbox can test

Circle Mint exposes production-shaped APIs at `https://api-sandbox.circle.com`. It can simulate bank account linking, wire deposits, balances, USDC deposits, redemption payout creation, status polling, failures, idempotency, and notifications. It does not send money to a real bank account.

## What you need to provide

1. A Circle developer sandbox account with Circle Mint access.
2. A sandbox API key stored as `CIRCLE_MINT_API_KEY`.
3. A sandbox wire bank account created in Circle Mint, with its ID stored as `CIRCLE_MINT_BANK_ACCOUNT_ID`.
4. A dedicated developer-controlled SCA wallet on Arc Testnet. Store its values as `CIRCLE_SETTLEMENT_WALLET_ID` and `CIRCLE_SETTLEMENT_WALLET_ADDRESS`. The existing escrow agent wallet may be reused for a limited hackathon test.
5. Add that settlement wallet as an Arc recipient address in Circle Mint. An account administrator must approve it in the Mint Console. Store its Circle address ID as `CIRCLE_MINT_SETTLEMENT_RECIPIENT_ADDRESS_ID`.
6. Set `PAYMENT_SESSION_SANDBOX_MAX_USD` to a small amount such as `10`.
7. An optional webhook verification secret. The session flow also refreshes provider status by polling.

Copy `.env.example` to `.env.local`, fill the Circle Mint API key and wire bank account ID, optionally add a webhook secret, restart the dev server, then check `GET /api/fiat/status` while signed in.

## Fiat to Web3 proof sequence

1. The payer starts a clearly labeled simulated bank payment. No card or bank account is charged.
2. Circle creates a sandbox mock wire and returns a tracking reference.
3. OffGrid waits until the corresponding amount is available in the Circle Mint sandbox master balance.
4. Circle transfers the USDC to the pre-approved platform settlement wallet and returns a transfer ID and onchain hash.
5. The developer-controlled settlement wallet sends real Arc Testnet USDC to the receiver's bound wallet.
6. Both participants receive the same invoice with the final ArcScan transaction.

This is a sponsor-funded product demonstration. It must never be described as a real user bank payment. The amount cap prevents anonymous users from draining the funded test wallet.

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
