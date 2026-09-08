# Vercel testnet deployment

OffGrid is ready to run as a Vercel-hosted Arc Testnet dashboard. The browser still signs every wallet transaction; Vercel only serves the UI and authenticated API routes.

## 1. Create the hosted database

Create a Neon Postgres database through the Vercel Marketplace, or use an existing Neon project. Connect it to the Vercel project so `POSTGRES_URL` (or `DATABASE_URL`) is available to Production and Preview environments.

The first authenticated request creates the small `offgrid_state` table automatically. The store uses an optimistic revision check so concurrent serverless requests do not overwrite each other. Local development continues to use `.data/offgrid.json` when no Postgres URL is present.

## 2. Configure Vercel environment variables

Add these variables to the environments you want to test:

| Variable | Required | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | Yes | At least 32 random characters; use a different value per environment. |
| `POSTGRES_URL` or `DATABASE_URL` | Yes | Neon/Vercel Postgres connection string. Never expose it as `NEXT_PUBLIC_*`. |
| `SOLANA_DEVNET_RPC_URL` | Recommended | Dedicated Solana Devnet RPC for the authenticated proxy. |
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | Recommended | Dedicated Base Sepolia RPC to avoid public RPC rate limits. |
| `NEXT_PUBLIC_ARC_RPC_URL` | Optional | Defaults to Arc Testnet RPC. |
| `NEXT_PUBLIC_ARC_SETTLEMENT_ADDRESS` | Required for crypto-to-fiat sessions | Audited Arc settlement contract only; leave empty to keep that rail disabled. |
| `CIRCLE_MINT_BASE_URL` | Optional | Keep the sandbox URL while testing fiat flows. |
| `CIRCLE_MINT_API_KEY` | Optional | Server-only Circle Mint sandbox credential. |
| `CIRCLE_MINT_BANK_ACCOUNT_ID` | Optional | Sandbox linked bank account. |
| `CIRCLE_API_KEY` | Required for verified sandbox payouts | Server-only Circle Wallets API key. |
| `CIRCLE_ENTITY_SECRET` | Required for verified sandbox payouts | Registered developer-wallet entity secret. |
| `CIRCLE_SETTLEMENT_WALLET_ID` | Required for verified sandbox payouts | Pre-funded developer-controlled Arc Testnet wallet ID. |
| `CIRCLE_SETTLEMENT_WALLET_ADDRESS` | Required for verified sandbox payouts | Address belonging to the settlement wallet ID. |
| `PAYMENT_SESSION_SANDBOX_MAX_USD` | Recommended | Keep the sponsor-funded demo cap small, for example `10`. |
| `PAYOUT_WEBHOOK_SECRET` | Optional | Secret used by `/api/payouts/webhook`. |
| `STRIPE_SECRET_KEY` | Optional | Server-only Stripe Crypto On-Ramp key. |
| `STRIPE_ONRAMP_PUBLISHABLE_KEY` | Optional | Stripe client key returned to the on-ramp UI. |
| `MOONPAY_PUBLISHABLE_KEY` / `MOONPAY_SECRET_KEY` | Optional | MoonPay sandbox credentials; both are required together. |

Do not add Circle, Stripe, database, or webhook secrets to `NEXT_PUBLIC_*` variables.

## 3. Deploy

```bash
npx vercel link
npx vercel env add SESSION_SECRET production
npx vercel env add POSTGRES_URL production
npx vercel --prod
```

The repository includes `vercel.json` with `npm ci` and `npm run build`. Vercel should use Node 22 or newer, matching the `engines` field in `package.json`.

## 4. Verify the live deployment

Open `/api/health` on the deployed domain. A healthy response includes:

```json
{
  "ok": true,
  "persistence": "postgres",
  "arc": "Arc_Testnet"
}
```

Then test in this order:

1. Register and log in with a new account.
2. Connect Rabby/MetaMask and add Arc Testnet.
3. Request testnet USDC from Circle Faucet.
4. Deposit a small amount into Gateway and wait for indexing.
5. Send an Arc wallet payment, then a Gateway payment.
6. Refresh the page and confirm History, payment sessions, and CCTP status persist.
7. If using Solana, connect a Devnet wallet and verify `/api/solana/rpc` works without exposing the RPC URL.

## Production boundaries

The hosted testnet deployment is not a production payroll system yet. Replace the JSON-shaped state boundary with normalized tables and a ledger before high-volume use, add rate limiting and CSRF/origin checks to auth routes, configure a real payout provider and webhook idempotency, and keep all keys in Vercel encrypted environment variables.
