# OffGrid Developer Guide: SIWE Auth & Two-Sided History Architecture

This guide serves as an authoritative architectural reference and change log for developers (and AI assistants) working on **OffGrid**. It documents the transition from password-based authentication to **Sign-In With Ethereum (SIWE / EIP-4361)**, privacy-preserving database storage, and complete two-sided activity tracking.

---

## 1. Architectural Principles & Privacy Model

### Web3 Privacy Guardrails
1. **Zero Key / Password Custody**: OffGrid never handles, stores, or sees private keys, seed phrases, or user passwords.
2. **Minimal Data Footprint**: The database stores no emails, password hashes, or password salts. A user account consists only of a unique ID, a primary `walletAddress`, an optional `username` (or ENS / 0x address fallback), `displayName`, and creation metadata.
3. **Public Identifiers & Hashes**: Authentication is proven through cryptographic wallet signatures over server-issued EIP-4361 challenges (nonces).
4. **Transparent On-Chain & Counterparty Tracking**: Every payment session, CCTP bridge step, Gateway spend, or direct Arc transfer generates a dual-indexed invoice record visible to both the sender and the recipient.

---

## 2. SIWE Authentication Architecture

### EIP-4361 Signature Flow

```
+----------------+                +-------------------+                +--------------------+
| Browser Wallet |                | OffGrid Front-End |                |   OffGrid Server   |
+----------------+                +-------------------+                +--------------------+
        |                                   |                                     |
        |                                   |  1. GET /api/auth/nonce             |
        |                                   |------------------------------------>|
        |                                   |  2. Returns { nonce }               |
        |                                   |<------------------------------------|
        |                                   |                                     |
        |  3. User signs EIP-4361 message   |                                     |
        |<----------------------------------|                                     |
        |  4. Returns signature             |                                     |
        |---------------------------------->|                                     |
        |                                   |  5. POST /api/auth/siwe             |
        |                                   |     { address, message, signature,  |
        |                                   |       username, displayName }       |
        |                                   |------------------------------------>|
        |                                   |                                     |
        |                                   |     - Verifies SIWE signature via   |
        |                                   |       viem `verifyMessage`          |
        |                                   |     - Creates/Updates user in DB    |
        |                                   |     - Sets HttpOnly Session Cookie  |
        |                                   |  6. Returns { user }                |
        |                                   |<------------------------------------|
```

### Challenge / Nonce Endpoint (`GET /api/auth/nonce`)
- Generates an unguessable 32-character cryptographically secure nonce using `crypto.randomBytes(16).toString("hex")`.
- Stores the nonce in an HttpOnly cookie (`offgrid_nonce`, short TTL: 5 minutes) or session state.

### SIWE Login / Register Endpoint (`POST /api/auth/siwe`)
- **Payload**:
  - `address`: EVM checksummed address (`0x...`) or Solana wallet address.
  - `message`: EIP-4361 formatted string (includes domain, address, URI, version, chainId, nonce, issuedAt).
  - `signature`: 65-byte hex signature produced by the wallet.
  - `username` (optional): ENS name, custom handle (3–24 chars), or defaults to shortened wallet address (e.g. `0x1234...5678`).
  - `displayName` (optional): User display label.
- **Verification Logic**:
  1. Validates that `message` contains the correct server domain, matching `nonce` from cookie, and matching `address`.
  2. Uses `viem` `verifyMessage({ address, message, signature })` to verify EVM signatures on Arc or Ethereum/Base/Arbitrum networks.
  3. Uses `@solana/web3.js` / `ed25519` verification for Solana Devnet signatures when applicable.
  4. On successful verification:
     - Looks up user by lowercased `walletAddress`.
     - If user exists, updates `username` / `displayName` if provided.
     - If user is new, creates `StoredUser` without password fields.
     - Issues the HMAC-signed `offgrid_session` cookie containing `userId`.

---

## 3. Database Schema Changes (`lib/server/store.ts`)

### `StoredUser` Schema Migration

```typescript
// BEFORE (Password-based):
export interface StoredUser {
  id: string;
  email: string;             // REMOVED
  username: string;
  displayName: string;
  passwordHash: string;      // REMOVED
  passwordSalt: string;      // REMOVED
  walletAddress: string | null;
  sandboxFiatBalance: string;
  sandboxFiatPending: string;
  createdAt: string;
}

// AFTER (SIWE-native & Privacy-First):
export interface StoredUser {
  id: string;
  walletAddress: string;     // REQUIRED: Lowercased or Checksummed primary address
  username: string;          // ENS / custom handle / 0x address fallback
  displayName: string;
  sandboxFiatBalance: string;
  sandboxFiatPending: string;
  createdAt: string;
}
```

---

## 4. Two-Sided Activity & History Tracking

### Universal Counterparty Indexing
When any invoice or transfer is saved (`POST /api/invoices` or automated CCTP mint completion):
1. **Automatic Recipient Resolution**:
   - The server inspects `recipientAddress`.
   - If `recipientUserId` is not explicitly passed, the server performs a database query for any user whose `walletAddress.toLowerCase() === recipientAddress.toLowerCase()`.
   - If found, `recipientUserId` is populated atomically on the invoice.
2. **Dual-Sided Querying**:
   - `GET /api/invoices` queries all invoices where:
     ```typescript
     invoice.senderId === currentUser.id ||
     invoice.recipientUserId === currentUser.id ||
     invoice.recipientAddress.toLowerCase() === currentUser.walletAddress.toLowerCase()
     ```
   - This guarantees that both the payer (Sender) and payee (Recipient) see the transaction in their respective History tabs with correct direction labels (`Sent` vs `Received`).

### Unified Activity Lifecycle Tracking
All payment mechanisms flow into the same canonical `invoices` database array:
- **Arc Direct Transfers**: Protocol `send`, `fundingMethod: "arc_wallet"`.
- **Circle Gateway Spends**: Protocol `gateway`, `fundingMethod: "unified_balance"`.
- **CCTP Cross-Chain Bridges**: Protocol `cctp`, `fundingMethod: "cctp_bridge"`, includes `bridgeSteps` (Burn tx, Attestation status, Mint tx).
- **Payment Sessions**: Session ID bound to invoice; locks payment terms prior to execution.
- **Mass Payment Runs**: Individual recipient invoices generated per confirmed transaction hash.
- **Fiat Off-Ramp**: Protocol `fiat`, `fundingMethod: "fiat_bank"`.

---

## 5. Developer Handoff Checklist for AI Coders

When extending or maintaining OffGrid:
- [x] **Auth Check**: Always use `getCurrentUser()` from `@/lib/server/auth` in API routes.
- [x] **No Password Inputs**: Do not add email or password fields to UI forms; auth is driven by wallet connection & SIWE modal.
- [x] **Vercel Database Persistence**: Ensure `POSTGRES_URL` or `DATABASE_URL` is set in production so `store.ts` uses Neon serverless HTTP queries.
- [x] **Transaction Verification**: `POST /api/invoices` enforces a valid 32-byte hex transaction hash for Web3 payments before adding to History.
