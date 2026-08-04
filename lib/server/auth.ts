import "server-only";

import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { mutateDatabase, publicUser, queryDatabase, type StoredUser } from "./store";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "offgrid_session";
const sessionLifetimeSeconds = 60 * 60 * 24 * 14;

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production");
  return "offgrid-local-development-only-secret";
}

async function hashPassword(password: string, salt: string) {
  const derivedKey = await scrypt(password, salt, 64) as Buffer;
  return derivedKey.toString("hex");
}

export function createSessionToken(userId: string) {
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt: Date.now() + sessionLifetimeSeconds * 1000 })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function parseSessionToken(token: string | undefined) {
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

export async function createUser(input: { email: string; username: string; displayName: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address");
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Username must be 3–24 letters, numbers, or underscores");
  if (displayName.length < 2 || displayName.length > 48) throw new Error("Display name must be 2–48 characters");
  if (input.password.length < 10) throw new Error("Password must be at least 10 characters");

  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(input.password, salt);
  return mutateDatabase((database) => {
    if (database.users.some((user) => user.email === email)) throw new Error("An account already uses this email");
    if (database.users.some((user) => user.username === username)) throw new Error("This username is already taken");
    const user: StoredUser = {
      id: randomUUID(), email, username, displayName, passwordHash, passwordSalt: salt,
      walletAddress: null,
      sandboxFiatBalance: "0",
      sandboxFiatPending: "0",
      createdAt: new Date().toISOString(),
    };
    database.users.push(user);
    return publicUser(user);
  });
}

export async function authenticateUser(login: string, password: string) {
  const normalized = login.trim().toLowerCase();
  const user = await queryDatabase((database) => database.users.find((entry) => entry.email === normalized || entry.username === normalized));
  if (!user) return null;
  const candidate = Buffer.from(await hashPassword(password, user.passwordSalt), "hex");
  const expected = Buffer.from(user.passwordHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected) ? publicUser(user) : null;
}

export async function getCurrentUser() {
  const session = parseSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return queryDatabase((database) => {
    const user = database.users.find((entry) => entry.id === session.userId);
    return user ? publicUser(user) : null;
  });
}
