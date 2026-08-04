# Fiat sandbox setup

OffGrid's fiat rail is negotiated in payment sessions, but execution stays disabled until a real provider sandbox is configured. The recommended first integration is Circle Mint sandbox because it matches the existing Circle and USDC settlement stack.

## What the sandbox can test

Circle Mint exposes production-shaped APIs at `https://api-sandbox.circle.com`. It can simulate bank account linking, wire deposits, balances, USDC deposits, redemption payout creation, status polling, failures, idempotency, and notifications. It does not send money to a real bank account.

## What you need to provide

1. A Circle developer sandbox account with Circle Mint access.
2. A sandbox API key stored as `CIRCLE_MINT_API_KEY`.
3. A sandbox wire bank account created in Circle Mint, with its ID stored as `CIRCLE_MINT_BANK_ACCOUNT_ID` for a platform-owned test destination.
4. An optional webhook verification secret if you want to validate external notifications. Local testing with this repo can run without a live webhook receiver because payout status is also refreshed by polling Circle.
5. Testnet USDC on a chain accepted by Circle Mint's deposit API. Do not send Arc USDC to an address unless Circle explicitly lists Arc for that product. Route through CCTP to a supported testnet first when necessary.

Copy `.env.example` to `.env.local`, fill the Circle Mint API key and wire bank account ID, optionally add a webhook secret, restart the dev server, then check `GET /api/fiat/status` while signed in.

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
