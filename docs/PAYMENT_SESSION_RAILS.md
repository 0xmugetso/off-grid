# Payment session rail matrix

OffGrid payment sessions lock the amount, direction, participants, and each participant's preferred rail. A session is not a settlement engine by itself. It coordinates the correct Circle or onchain flow and must keep the session pending until external proof exists.

## Supported combinations

| Payer input | Receiver output | Required settlement sequence | Current launch status |
| --- | --- | --- | --- |
| Web3 USDC | Web3 USDC | Direct Arc Testnet transfer, Gateway spend, or CCTP transfer, followed by a confirmed transaction and shared invoice | Testable on testnet |
| Fiat bank | Web3 USDC | Circle Mint wire instructions, fiat deposit, settled Circle balance, recipient address registration, then an onchain Circle Mint transfer | Provider orchestration pending |
| Web3 USDC | Fiat bank | Circle Mint deposit address, confirmed USDC credit, then redemption to a linked and verified bank account | Provider orchestration pending |
| Fiat bank | Fiat bank | Circle Mint fiat deposit, confirmed balance, then redemption to the receiver's linked and verified bank account | Provider orchestration pending |

The three fiat combinations must never become complete from a button click alone. A provider ID, status, and settlement proof are required for every applicable stage.

## Participant updates

The dashboard polls live sessions every five seconds while a session is open or ready. The private session window polls every four seconds while visible. Both surfaces compare the last session snapshot and show an in-app notification when the counterparty locks a choice or settlement completes.

The compact live-session control in the dashboard always shows the next action for the signed-in participant. It opens the full session list and progression view.

## Capability links

New session URLs use a random 256-bit capability token. The database stores the token and its SHA-256 hash. API lookup accepts the capability token, while participant-only list and archive operations can use the hash. Changing any URL character produces a different hash and cannot expose another session unless the complete random token is known.

Legacy sessions created before the raw capability token was retained cannot have their original link reconstructed from the hash. The UI labels those links unavailable instead of displaying a fake URL.

## Manual test checklist

1. Create a Web3 payer session and copy its exact `/session/<token>` URL.
2. Open the URL as a second authenticated user and select Web3 USDC.
3. Confirm the creator receives the choice-locked notification within five seconds.
4. Open the session from the dashboard and confirm the next action is payment submission.
5. Select Execute payment and confirm the dashboard scrolls to the prefilled payment console.
6. Submit a direct, Gateway, or CCTP payment and confirm both participants receive the completed state and shared invoice.
7. Repeat each direction with a fiat selection and confirm the session remains pending with provider requirements visible. It must not create a payout or completion record without confirmed Circle stages.

## Official references

- Arc App Kit unified balance quickstart: https://docs.arc.io/app-kit/quickstarts/unified-balance-deposit-and-spend
- Circle Mint mint and redeem quickstart: https://developers.circle.com/circle-mint/quickstarts/mint-and-redeem
- Circle Mint supported chains and currencies: https://developers.circle.com/circle-mint/references/supported-chains-and-currencies
- CCTP supported chains and domains: https://developers.circle.com/cctp/concepts/supported-chains-and-domains
