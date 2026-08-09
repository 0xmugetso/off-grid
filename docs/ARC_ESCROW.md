# Arc AI Escrow

OffGrid follows Circle's official `arc-escrow` sequence while keeping the product's participant accounts and dashboard design:

1. The depositor creates an agreement with a registered beneficiary.
2. OffGrid provisions one Circle developer-controlled SCA wallet per participant.
3. Circle Smart Contract Platform deploys a dedicated `RefundProtocol` contract on Arc Testnet.
4. The depositor funds their Circle SCA wallet, approves USDC, and calls `pay` for payment ID `0`.
5. The beneficiary uploads image evidence. OpenAI vision evaluates it against the agreement criteria.
6. A `HIGH` confidence pass calls `withdraw([0])`; the beneficiary can instead call `refundByRecipient(0)`.
7. Circle transaction IDs and webhook updates are stored, then reconciled after navigation or refresh.

The contract in `contracts/RefundProtocol.sol` preserves the official payment, refund, withdrawal, arbiter, and EIP-712 early-withdrawal behavior. It is compiled during `npm run build`; the generated ABI and bytecode are consumed server-side.

## Required hosted environment

Set these as encrypted Vercel environment variables:

- `CIRCLE_API_KEY`
- `CIRCLE_ENTITY_SECRET`
- `CIRCLE_ESCROW_AGENT_WALLET_ID`
- `CIRCLE_ESCROW_AGENT_ADDRESS`
- `GEMINI_API_KEY` (recommended for testnet; Google AI Studio provides limited free quota)
- optionally `GEMINI_ESCROW_MODEL` (defaults to `gemini-3.6-flash`)
- optionally `ESCROW_AI_PROVIDER=openai` plus `OPENAI_API_KEY` if you want the OpenAI path

Create the dedicated Arc Testnet agent wallet once:

```bash
npm run circle:create-escrow-agent
```

Configure Circle transaction notifications to POST to:

```text
https://YOUR_DOMAIN/api/webhooks/circle
```

The endpoint verifies `x-circle-signature` against Circle's public key before recording any transaction state. Never expose the API key, entity secret, agent wallet ID, or OpenAI key through `NEXT_PUBLIC_*` variables.

Google AI Studio creates a Gemini key from its API keys page. Free-tier availability and quotas vary by account and region; the app keeps the AI provider configurable and will show a setup error instead of auto-releasing funds when the provider is unavailable.
