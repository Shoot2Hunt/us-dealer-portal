import "server-only";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, users, type User } from "@/lib/db";
import { decryptSecret, hashRecoveryCode, looksLikeRecoveryCode, verifyTotp } from "./totp";

/** After this many wrong codes in a row, stop accepting codes for a while. */
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

/** Column values for "two-step verification off". */
export const CLEARED_TWO_FACTOR = {
  totpSecret: null,
  totpPendingSecret: null,
  totpEnabledAt: null,
  totpLastStep: null,
  totpFailedAttempts: 0,
  totpLockedUntil: null,
  recoveryCodeHashes: null,
} satisfies Partial<User>;

export type SecondFactorResult =
  | { ok: true; usedRecoveryCode: boolean; recoveryCodesLeft: number }
  | { ok: false; error: string };

/**
 * Check a 6-digit authenticator code or a one-time recovery code for a user who has
 * two-step verification on. Each code works once; repeated wrong codes lock it briefly.
 */
export async function checkSecondFactor(user: User, input: string): Promise<SecondFactorResult> {
  if (!user.totpSecret) return { ok: false, error: "Two-step verification isn't set up on this account." };
  if (user.totpLockedUntil && user.totpLockedUntil > new Date()) {
    const mins = Math.ceil((user.totpLockedUntil.getTime() - Date.now()) / 60000);
    return { ok: false, error: `Too many incorrect codes. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  const code = input.trim();
  if (!code) return { ok: false, error: "Enter the code from your authenticator app." };

  let ok = false;
  let usedRecoveryCode = false;
  let left = user.recoveryCodeHashes?.length ?? 0;

  if (looksLikeRecoveryCode(code)) {
    // Remove the code only if it's still there, in one statement, so it can't be used twice.
    const hash = hashRecoveryCode(code);
    const [row] = await db()
      .update(users)
      .set({ recoveryCodeHashes: sql`array_remove(${users.recoveryCodeHashes}, ${hash})`, totpFailedAttempts: 0, totpLockedUntil: null })
      .where(and(eq(users.id, user.id), sql`${hash} = any(${users.recoveryCodeHashes})`))
      .returning({ left: users.recoveryCodeHashes });
    ok = Boolean(row);
    usedRecoveryCode = ok;
    if (row) left = row.left?.length ?? 0;
  } else {
    const step = verifyTotp(decryptSecret(user.totpSecret), code, user.totpLastStep);
    if (step != null) {
      // Same idea: record the step only if it's newer than the last one used.
      const [row] = await db()
        .update(users)
        .set({ totpLastStep: step, totpFailedAttempts: 0, totpLockedUntil: null })
        .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      ok = Boolean(row);
    }
  }

  if (ok) return { ok: true, usedRecoveryCode, recoveryCodesLeft: left };

  const [row] = await db()
    .update(users)
    .set({ totpFailedAttempts: sql`${users.totpFailedAttempts} + 1` })
    .where(eq(users.id, user.id))
    .returning({ failures: users.totpFailedAttempts });
  if (row && row.failures >= MAX_FAILURES) {
    await db()
      .update(users)
      .set({ totpFailedAttempts: 0, totpLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) })
      .where(eq(users.id, user.id));
    return { ok: false, error: `Too many incorrect codes. Try again in ${LOCK_MINUTES} minutes.` };
  }
  return {
    ok: false,
    error: looksLikeRecoveryCode(code)
      ? "That recovery code isn't valid or was already used."
      : "That code isn't right. Check your authenticator app and enter the current 6-digit code.",
  };
}
