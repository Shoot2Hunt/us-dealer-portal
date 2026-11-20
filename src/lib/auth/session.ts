import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, users, type User } from "@/lib/db";
import { readSession, SESSION_COOKIE, SESSION_DAYS, signSession } from "./token";

export async function startSession(user: User) {
  const token = await signSession({ sub: user.id, role: user.role });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in, active user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [user] = await db().select().from(users).where(eq(users.id, session.sub));
  if (!user || user.status !== "active") return null;
  return user;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
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
