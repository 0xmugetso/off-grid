import "server-only";

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAddress, isAddress, verifyMessage } from "viem";
import { mutateDatabase, publicUser, queryDatabase, type StoredUser } from "./store";

export const SESSION_COOKIE = "offgrid_session";
export const NONCE_COOKIE = "offgrid_nonce";
const sessionLifetimeSeconds = 60 * 60 * 24 * 14;

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production");
  return "offgrid-local-development-only-secret";
}

export function generateNonce() {
  return randomBytes(16).toString("hex");
}

export function createSessionToken(userId: string) {
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt: Date.now() + sessionLifetimeSeconds * 1000 })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function parseSessionToken(token: string | undefined) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId: string; expiresAt: number };
    return session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: sessionLifetimeSeconds,
};

export const nonceCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 10, // 10 minutes
};

export async function verifySiweMessage(params: {
  address: string;
  message: string;
  signature: string;
  storedNonce?: string;
}) {
  const { address, message, signature, storedNonce } = params;
  if (!address || !isAddress(address)) {
    throw new Error("Invalid wallet address");
  }
  if (!message || !signature) {
    throw new Error("Missing SIWE message or signature");
  }

  // Check nonce if provided
  if (storedNonce && !message.includes(storedNonce)) {
    throw new Error("SIWE nonce mismatch or expired challenge");
  }

  // Verify EVM signature using Viem
  if (isAddress(address)) {
    const checksummed = getAddress(address);
    const isValid = await verifyMessage({
      address: checksummed,
      message,
      signature: signature as `0x${string}`,
    }).catch(() => false);

    if (!isValid) {
      throw new Error("Invalid SIWE signature for address");
    }
    return checksummed;
  }

  // Solana wallets are supported for payments, but this endpoint is SIWE
  // (EIP-4361) authentication. Never create an authenticated session for a
  // non-EVM address without a dedicated, verified Solana auth flow.
  throw new Error("OffGrid sign-in currently requires an EVM wallet; connect Solana after signing in");
}

export async function authenticateOrRegisterSiweUser(input: {
  address: string;
  message: string;
  signature: string;
  mode?: "signin" | "register";
  username?: string;
  displayName?: string;
}) {
  const cookieStore = await cookies();
  const storedNonce = cookieStore.get(NONCE_COOKIE)?.value;
  const verifiedAddress = await verifySiweMessage({
    address: input.address,
    message: input.message,
    signature: input.signature,
    storedNonce,
  });

  const normalizedAddress = verifiedAddress.toLowerCase();
  const defaultHandle = `${verifiedAddress.slice(0, 6)}...${verifiedAddress.slice(-4)}`;
  const requestedUsername = (input.username?.trim() || defaultHandle).toLowerCase();
  const requestedDisplayName = input.displayName?.trim() || input.username?.trim() || defaultHandle;
  if (input.username?.trim() && !/^[a-z0-9][a-z0-9_-]{2,23}$/.test(requestedUsername)) {
    throw new Error("Username must be 3 to 24 characters using letters, numbers, underscores, or hyphens");
  }

  return mutateDatabase((database) => {
    let user = database.users.find(
      (u) => u.walletAddress && u.walletAddress.toLowerCase() === normalizedAddress
    );

    if (!user && input.mode === "signin") {
      throw new Error("No OffGrid account is linked to this wallet. Choose Register to create one.");
    }

    if (user) {
      // Update display name or username if provided
      if (input.displayName?.trim()) user.displayName = input.displayName.trim();
      if (input.username?.trim() && !database.users.some((u) => u.id !== user!.id && u.username === requestedUsername)) {
        user.username = requestedUsername;
      }
    } else {
      // Create new SIWE user
      const takenUsername = database.users.some((u) => u.username === requestedUsername);
      const finalUsername = takenUsername ? `${requestedUsername.slice(0, 19)}_${randomBytes(2).toString("hex")}` : requestedUsername;

      user = {
        id: randomUUID(),
        walletAddress: verifiedAddress,
        username: finalUsername,
        displayName: requestedDisplayName,
        sandboxFiatBalance: "0",
        sandboxFiatPending: "0",
        createdAt: new Date().toISOString(),
      };
      database.users.push(user);
    }

    return publicUser(user);
  });
}

export async function getCurrentUser() {
  const session = parseSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return queryDatabase((database) => {
    const user = database.users.find((entry) => entry.id === session.userId);
    return user ? publicUser(user) : null;
  });
}
