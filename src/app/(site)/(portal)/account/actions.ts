"use server";

import { after } from "next/server";
import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { phoneField } from "@/lib/phone";
import { db, users, type Address } from "@/lib/db";
import {
  checkPassword,
  hashPassword,

  requireSignedIn,
  signOutOtherSessions,
  startSession,
  twoFactorEnabled,
} from "@/lib/auth/session";
import { checkSecondFactor, CLEARED_TWO_FACTOR } from "@/lib/auth/two-factor";
import { passwordProblem } from "@/lib/auth/password-policy";
import { decryptSecret, encryptSecret, newRecoveryCodes, newTotpSecret, verifyTotp } from "@/lib/auth/totp";
import { sendEmail } from "@/lib/email";
import { passwordChanged, twoFactorDisabled, twoFactorEnabled as twoFactorEnabledEmail } from "@/lib/email-templates";
import { reportError } from "@/lib/errors";

export type AccountState = { error?: string; ok?: boolean; message?: string; codes?: string[] } | undefined;

const failure = (scope: string, err: unknown): AccountState => ({
  error: `Something went wrong on our side. Please try again. If it keeps happening, contact us and mention reference ${reportError(scope, err)}.`,
});

/** Send a security email after the response, without failing the action if it can't be sent. */
function notify(scope: string, send: () => Promise<unknown>) {
  after(async () => {
    try {
      await send();
    } catch (err) {
      reportError(scope, err);
    }
  });
}

// --- Profile ---

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  phone: phoneField,
});

const addressSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name for shipping"),
  lastName: z.string().trim().min(1, "Enter a last name for shipping"),
  company: z.string().trim().optional(),
  address1: z.string().trim().min(3, "Enter a street address"),
  address2: z.string().trim().optional(),
  city: z.string().trim().min(2, "Enter a city"),
  state: z.string().trim().min(2, "Enter a state"),
  postcode: z.string().trim().min(3, "Enter a ZIP code"),
  phone: phoneField,
});

const opt = (form: FormData, key: string) => String(form.get(key) ?? "").trim() || undefined;

export async function updateProfile(_: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireSignedIn();
  const parsed = profileSchema.safeParse({ name: form.get("name"), phone: opt(form, "phone") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  // Default shipping address (dealers): optional, but if any field is filled, it must be complete.
  let shippingAddress: Address | null | undefined;
  if (user.role === "dealer") {
    const raw = Object.fromEntries(Object.keys(addressSchema.shape).map((k) => [k, opt(form, `ship_${k}`)]));
    if (Object.values(raw).some(Boolean)) {
      const addr = addressSchema.safeParse(raw);
      if (!addr.success) return { error: addr.error.issues[0]?.message };
      shippingAddress = addr.data;
    } else {
      shippingAddress = null;
    }
  }

  try {
    await db()
      .update(users)
      .set({ name: parsed.data.name, phone: parsed.data.phone ?? null, ...(shippingAddress !== undefined && { shippingAddress }) })
      .where(eq(users.id, user.id));
  } catch (err) {
    return failure("update profile", err);
  }
  refresh();
  return { ok: true, message: "Profile saved." };
}

// --- Password ---

export async function changePassword(_: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireSignedIn();
  const current = String(form.get("current") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const problem = await passwordProblem(password, { email: user.email, name: user.name });
  if (problem) return { error: problem };
  if (password !== confirm) return { error: "The new passwords don't match." };
  if (password === current) return { error: "Choose a password that's different from your current one." };

  try {
    if (!user.passwordHash || !(await checkPassword(current, user.passwordHash))) {
      return { error: "Your current password isn't right." };
    }
    // Other devices are signed out; this browser gets a fresh session.
    const updated = await signOutOtherSessions(user.id, { passwordHash: await hashPassword(password), passwordChangedAt: new Date() });
    await startSession(updated);
  } catch (err) {
    return failure("change password", err);
  }
  notify("password changed email", async () =>
    sendEmail({ to: user.email, kind: "password.changed", ...(await passwordChanged({ name: user.name })) }),
  );
  refresh();
  return { ok: true, message: "Password changed. Any other devices signed in to your account have been signed out." };
}

export async function signOutEverywhere(): Promise<void> {
  const user = await requireSignedIn();
  try {
    await startSession(await signOutOtherSessions(user.id));
  } catch (err) {
    reportError("sign out everywhere", err);
    throw err;
  }
  refresh();
}

// --- Two-step verification ---

/** Step 1: make a secret and show the QR code. Nothing changes for sign-in until it's confirmed. */
export async function beginTwoFactorSetup(): Promise<void> {
  const user = await requireSignedIn();
  if (twoFactorEnabled(user)) return;
  await db().update(users).set({ totpPendingSecret: encryptSecret(newTotpSecret()) }).where(eq(users.id, user.id));
  refresh();
}

export async function cancelTwoFactorSetup(): Promise<void> {
  const user = await requireSignedIn();
  await db().update(users).set({ totpPendingSecret: null }).where(eq(users.id, user.id));
  refresh();
}

/** Step 2: the user proves their app is set up by entering a code. Then it's on. */
export async function confirmTwoFactorSetup(_: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireSignedIn();
  if (twoFactorEnabled(user)) return { error: "Two-step verification is already on." };
  if (!user.totpPendingSecret) return { error: "Setup expired. Start again." };

  let codes: string[];
  try {
    const secret = decryptSecret(user.totpPendingSecret);
    const step = verifyTotp(secret, String(form.get("code") ?? ""));
    if (step == null) return { error: "That code didn't match. Make sure you scanned the code on this page, then enter the current 6-digit code." };
    const recovery = newRecoveryCodes();
    codes = recovery.codes;
    await db()
      .update(users)
      .set({
        totpSecret: user.totpPendingSecret,
        totpPendingSecret: null,
        totpEnabledAt: new Date(),
        totpLastStep: step,
        totpFailedAttempts: 0,
        totpLockedUntil: null,
        recoveryCodeHashes: recovery.hashes,
      })
      .where(eq(users.id, user.id));
  } catch (err) {
    return failure("enable 2fa", err);
  }
  notify("2fa enabled email", async () =>
    sendEmail({ to: user.email, kind: "2fa.enabled", ...(await twoFactorEnabledEmail({ name: user.name })) }),
  );
  refresh();
  return { ok: true, codes, message: "Two-step verification is on." };
}

export async function regenerateRecoveryCodes(_: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireSignedIn();
  if (!twoFactorEnabled(user)) return { error: "Turn on two-step verification first." };
  let codes: string[];
  try {
    const check = await checkSecondFactor(user, String(form.get("code") ?? ""));
    if (!check.ok) return { error: check.error };
    const recovery = newRecoveryCodes();
    codes = recovery.codes;
    await db().update(users).set({ recoveryCodeHashes: recovery.hashes }).where(eq(users.id, user.id));
  } catch (err) {
    return failure("regenerate recovery codes", err);
  }
  refresh();
  return { ok: true, codes, message: "New recovery codes created. Your old codes no longer work." };
}

export async function disableTwoFactor(_: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireSignedIn();
  if (!twoFactorEnabled(user)) return { error: "Two-step verification is already off." };
  try {
    if (!user.passwordHash || !(await checkPassword(String(form.get("password") ?? ""), user.passwordHash))) {
      return { error: "Your password isn't right." };
    }
    const check = await checkSecondFactor(user, String(form.get("code") ?? ""));
    if (!check.ok) return { error: check.error };
    await db().update(users).set(CLEARED_TWO_FACTOR).where(eq(users.id, user.id));
  } catch (err) {
    return failure("disable 2fa", err);
  }
  notify("2fa disabled email", async () =>
    sendEmail({ to: user.email, kind: "2fa.disabled", ...(await twoFactorDisabled({ name: user.name, byAdmin: false })) }),
  );
  refresh();
  return { ok: true, message: "Two-step verification is off." };
}

