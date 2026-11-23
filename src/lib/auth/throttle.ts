import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, loginThrottle } from "@/lib/db";
import { getSecuritySettings } from "@/sanity/content";

/**
 * Wrong-password lockout, configured in Sanity → Security. Counted per email address
 * whether or not an account exists, so the lockout message can't reveal real accounts.
 */

/** Minutes left on a lockout, or 0 when sign-in is allowed. */
export async function lockedMinutes(email: string): Promise<number> {
  const [row] = await db().select({ lockedUntil: loginThrottle.lockedUntil }).from(loginThrottle).where(eq(loginThrottle.key, email));
  const ms = row?.lockedUntil ? row.lockedUntil.getTime() - Date.now() : 0;
  return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}

/** Count a failure; locks the address once the limit is reached within the window. Returns minutes locked (0 if not). */
export async function recordLoginFailure(email: string): Promise<number> {
  const { maxLoginAttempts, lockoutMinutes } = await getSecuritySettings();
  // Failures older than one lockout length start a fresh count.
  const windowStart = new Date(Date.now() - lockoutMinutes * 60_000);
  const [row] = await db()
    .insert(loginThrottle)
    .values({ key: email, failures: 1, firstFailureAt: new Date() })
    .onConflictDoUpdate({
      target: loginThrottle.key,
      set: {
        failures: sql`case when ${loginThrottle.firstFailureAt} < ${windowStart} then 1 else ${loginThrottle.failures} + 1 end`,
        firstFailureAt: sql`case when ${loginThrottle.firstFailureAt} < ${windowStart} then now() else ${loginThrottle.firstFailureAt} end`,
      },
    })
    .returning({ failures: loginThrottle.failures });
  if ((row?.failures ?? 0) < maxLoginAttempts) return 0;
  await db()
    .update(loginThrottle)
    .set({ failures: 0, firstFailureAt: new Date(), lockedUntil: new Date(Date.now() + lockoutMinutes * 60_000) })
    .where(eq(loginThrottle.key, email));
  return lockoutMinutes;
}

export async function clearLoginFailures(email: string) {
  await db().delete(loginThrottle).where(eq(loginThrottle.key, email));
}

export const lockoutMessage = (minutes: number) =>
  `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or use "Forgot password" to reset it.`;
