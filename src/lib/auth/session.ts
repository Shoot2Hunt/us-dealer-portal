import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, users, type User } from "@/lib/db";
import { getSecuritySettings } from "@/sanity/content";
import {
  readSession,
  readTwoFactorTicket,
  SESSION_COOKIE,
  signSession,
  signTwoFactorTicket,
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_MINUTES,
} from "./token";

const cookieBase = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" } as const;

export async function startSession(user: User) {
  // Length comes from Sanity → Security (clamped to 1–30 days).
  const { sessionDays } = await getSecuritySettings();
  const token = await signSession({ sub: user.id, role: user.role, v: user.sessionVersion }, sessionDays);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { ...cookieBase, maxAge: sessionDays * 24 * 60 * 60 });
  jar.delete(TWO_FACTOR_COOKIE);
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(TWO_FACTOR_COOKIE);
}

/**
 * Sign the user out on every device (old session cookies stop working), and keep
 * this browser signed in with a fresh session. Returns the updated user.
 */
export async function signOutOtherSessions(userId: string, extra: Partial<User> = {}): Promise<User> {
  const [user] = await db()
    .update(users)
    .set({ ...extra, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId))
    .returning();
  return user;
}

// --- Two-step verification at sign-in ---

export const twoFactorEnabled = (user: User) => Boolean(user.totpEnabledAt && user.totpSecret);

/** Password was right; remember that for a few minutes while we ask for the code. */
export async function startTwoFactor(user: User, next: string) {
  const token = await signTwoFactorTicket({ sub: user.id, v: user.sessionVersion, next });
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.set(TWO_FACTOR_COOKIE, token, { ...cookieBase, maxAge: TWO_FACTOR_MINUTES * 60 });
}

/** The user waiting to enter their code, or null if there's no valid ticket. */
export async function getTwoFactorUser(): Promise<{ user: User; next: string } | null> {
  const ticket = await readTwoFactorTicket((await cookies()).get(TWO_FACTOR_COOKIE)?.value);
  if (!ticket) return null;
  const [user] = await db().select().from(users).where(eq(users.id, ticket.sub));
  if (!user || user.status !== "active" || user.sessionVersion !== ticket.v || !twoFactorEnabled(user)) return null;
  return { user, next: ticket.next };
}

/** The signed-in, active user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [user] = await db().select().from(users).where(eq(users.id, session.sub));
  if (!user || user.status !== "active") return null;
  // Signed out everywhere since this cookie was issued (e.g. password changed).
  if ((session.v ?? 0) !== user.sessionVersion) return null;
  return user;
});

/** Signed in and active, without the 2FA-required check. Only for the account page, where 2FA is set up. */
export async function requireSignedIn(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** True when Sanity → Security requires 2FA for this user's role and they haven't set it up. */
export async function twoFactorSetupRequired(user: User): Promise<boolean> {
  if (twoFactorEnabled(user)) return false;
  const policy = await getSecuritySettings();
  return isAdmin(user) ? policy.requireTwoFactorAdmins : policy.requireTwoFactorDealers;
}

/** Signed in and meeting the security policy; otherwise sent to sign in or to set up 2FA. */
export async function requireUser(): Promise<User> {
  const user = await requireSignedIn();
  if (await twoFactorSetupRequired(user)) redirect("/account?setup=2fa#two-factor");
  return user;
}

/** For API routes: the user only if they meet the security policy, else null (→ 401). */
export async function getApiUser(): Promise<User | null> {
  const user = await getCurrentUser();
  if (!user || (await twoFactorSetupRequired(user))) return null;
  return user;
}

export function isAdmin(user: User) {
  return user.role === "brand_admin" || user.role === "super_admin";
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/inventory");
  return user;
}

// --- Passwords and one-time setup links ---

export const MIN_PASSWORD_LENGTH = 10;

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const SETUP_LINK_TTL_MS = 7 * 864e5;
export const RESET_LINK_TTL_MS = 60 * 60 * 1000;

/**
 * Create a one-time link token. Only its hash is stored, and issuing a new one
 * invalidates any older link. Setup links last 7 days; reset links 1 hour.
 */
export async function issueSetupToken(userId: string, ttlMs = SETUP_LINK_TTL_MS): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db()
    .update(users)
    .set({ setupTokenHash: sha256(token), setupTokenExpires: new Date(Date.now() + ttlMs) })
    .where(eq(users.id, userId));
  return token;
}

export async function findUserBySetupToken(token: string): Promise<User | null> {
  const [user] = await db().select().from(users).where(eq(users.setupTokenHash, sha256(token)));
  if (!user || !user.setupTokenExpires || user.setupTokenExpires < new Date()) return null;
  return user;
}

/** Dealers can't order once their FFL (or, for NFA items, SOT) has expired. */
export function licenseProblems(user: User): string[] {
  const today = new Date().toISOString().slice(0, 10);
  const problems: string[] = [];
  if (user.role === "dealer") {
    if (!user.fflNumber) problems.push("No FFL on file.");
    else if (user.fflExpires && user.fflExpires < today) problems.push("Your FFL on file has expired.");
  }
  return problems;
}

export function hasCurrentSot(user: User): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return user.sotVerified && (!user.sotExpires || user.sotExpires >= today);
}
