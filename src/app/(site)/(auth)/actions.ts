"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { phoneField } from "@/lib/phone";
import { expiryProblem, type LicenseKind } from "@/lib/license-dates";
import { accessRequests, db, users, type User } from "@/lib/db";
import {
  checkPassword,
  endSession,
  findUserBySetupToken,
  getTwoFactorUser,
  hashPassword,
  issueSetupToken,

  RESET_LINK_TTL_MS,
  signOutOtherSessions,
  startSession,
  startTwoFactor,
  twoFactorEnabled,
} from "@/lib/auth/session";
import { checkSecondFactor } from "@/lib/auth/two-factor";
import { passwordProblem } from "@/lib/auth/password-policy";
import { clearLoginFailures, lockedMinutes, lockoutMessage, recordLoginFailure } from "@/lib/auth/throttle";
import { clientKey, rateLimit, tooManyMessage } from "@/lib/rate-limit";
import { appUrl, sendEmail } from "@/lib/email";
import {
  accessRequestCopy,
  accessRequestToAdmins,
  accountReady,
  passwordChanged,
  passwordReset,
  recoveryCodeUsed,
  type RequestSummary,
} from "@/lib/email-templates";
import { reportError } from "@/lib/errors";
import { getBrands } from "@/sanity/content";
import { isStoreKey, storeName } from "@/lib/woo/stores";
import { claimLicenseUploads, findUnclaimedUploads } from "@/lib/license-docs";
import { endRequestAccessSession, uploadTokenHash } from "@/lib/upload-session";

export type FormState = { error?: string; ok?: boolean; notice?: string } | undefined;

/** Friendly message for unexpected failures, with a code support can look up in the logs. */
const failure = (scope: string, err: unknown): FormState => ({
  error: `Something went wrong on our side. Please try again in a minute. If it keeps happening, contact us and mention reference ${reportError(scope, err)}.`,
});

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  if (!z.email().safeParse(email).success) return { error: "Enter a valid email address." };
  if (!password) return { error: "Enter your password." };
  let user: User | undefined;
  let needsCode = false;
  try {
    // Per network, across all emails: stops password spraying. Per-email lockout follows.
    const limit = await rateLimit(`login:${await clientKey()}`, 30, 15);
    if (!limit.ok) return { error: tooManyMessage(limit.retryMinutes) };
    const locked = await lockedMinutes(email);
    if (locked) return { error: lockoutMessage(locked) };
    [user] = await db().select().from(users).where(eq(users.email, email));
    // Same message for every failure so emails can't be probed.
    if (!user || user.status !== "active" || !user.passwordHash || !(await checkPassword(password, user.passwordHash))) {
      const nowLocked = await recordLoginFailure(email);
      if (nowLocked) return { error: lockoutMessage(nowLocked) };
      return { error: "That email and password don't match an active dealer account." };
    }
    await clearLoginFailures(email);
    needsCode = twoFactorEnabled(user);
    if (needsCode) await startTwoFactor(user, next);
    else await startSession(user);
  } catch (err) {
    return failure("login", err);
  }
  // redirect() throws on purpose, so it stays outside the try/catch.
  redirect(needsCode ? "/login/verify" : next || homeFor(user));
}

/**
 * Only same-site paths, so a crafted ?next= can't send people to another site. Rejects
 * backslashes and control characters too: browsers drop tabs/newlines, so "/\t/evil.com"
 * would otherwise turn into "//evil.com".
 */
function safeNext(next: string): string {
  const unsafeChar = [...next].some((c) => c === "\\" || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  if (!next.startsWith("/") || next.startsWith("//") || unsafeChar || next.length > 500) return "";
  try {
    const u = new URL(next, "https://portal.invalid");
    return u.origin === "https://portal.invalid" ? u.pathname + u.search + u.hash : "";
  } catch {
    return "";
  }
}
const homeFor = (user: User) => (user.role === "dealer" ? "/inventory" : "/admin");

/** Second step of sign-in: the authenticator code (or a recovery code). */
export async function verifyLogin(_: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get("code") ?? "");
  let pending: Awaited<ReturnType<typeof getTwoFactorUser>>;
  try {
    const limit = await rateLimit(`2fa:${await clientKey()}`, 20, 15);
    if (!limit.ok) return { error: tooManyMessage(limit.retryMinutes) };
    pending = await getTwoFactorUser();
    if (!pending) return { error: "Your sign-in timed out. Go back and enter your email and password again." };
    const result = await checkSecondFactor(pending.user, code);
    if (!result.ok) return { error: result.error };
    await startSession(pending.user);
    if (result.usedRecoveryCode) {
      const { email, name } = pending.user;
      after(async () => {
        try {
          await sendEmail({ to: email, kind: "2fa.recovery_used", ...(await recoveryCodeUsed({ name, left: result.recoveryCodesLeft })) });
        } catch (err) {
          reportError("recovery code email", err);
        }
      });
    }
  } catch (err) {
    return failure("verify login", err);
  }
  redirect(pending.next || homeFor(pending.user));
}

export async function logout() {
  await endSession();
  redirect("/login");
}

const expiryField = (kind: LicenseKind) =>
  z.string().superRefine((value, ctx) => {
    const problem = expiryProblem(kind, value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const requestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100, "Name is too long (100 characters max)"),
  email: z.email("Enter a valid email address").max(200).transform((s) => s.toLowerCase()),
  company: z.string().trim().min(2, "Enter your company").max(120, "Company name is too long (120 characters max)"),
  phone: phoneField,
  brandSlug: z.string().refine(isStoreKey, "Choose a brand"),
  fflNumber: z
    .string()
    .trim()
    .min(5, "Enter your FFL number")
    .max(40, "That FFL number is too long")
    .regex(/^[A-Za-z0-9\-\s]+$/, "FFL numbers can only contain letters, numbers and dashes"),
  // Same rules as the form (src/lib/license-dates.ts): real, not expired, not years too far out.
  fflExpires: expiryField("ffl"),
  // Every dealer needs a current SOT: number (usually the EIN it's registered under) and expiry.
  sotNumber: z
    .string()
    .trim()
    .min(5, "Enter your SOT number (EIN)")
    .max(40, "That SOT number is too long")
    .regex(/^[A-Za-z0-9\-\s]+$/, "SOT numbers can only contain letters, numbers and dashes"),
  sotExpires: expiryField("sot"),
  message: z.string().trim().max(2000).optional(),
});

export async function requestAccess(_: FormState, form: FormData): Promise<FormState> {
  const parsed = requestSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    company: form.get("company"),
    phone: form.get("phone") || undefined,
    brandSlug: form.get("brandSlug"),
    fflNumber: form.get("fflNumber"),
    fflExpires: form.get("fflExpires") ?? "",
    sotNumber: form.get("sotNumber") ?? "",
    sotExpires: form.get("sotExpires") ?? "",
    message: form.get("message") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const r = { ...parsed.data, hasSot: true };
  const wantsCopy = form.get("sendCopy") === "on";

  try {
    // Anti-automation: a few requests per network per hour, and per email per day.
    const [byIp, byEmail] = await Promise.all([rateLimit(`access:${await clientKey()}`, 5, 60), rateLimit(`access-email:${r.email}`, 3, 24 * 60)]);
    if (!byIp.ok) return { error: tooManyMessage(byIp.retryMinutes) };
    if (!byEmail.ok) return { error: "We've already received requests from this email today. We'll be in touch, or contact us directly." };

    // FFL and SOT copies (both required) were uploaded one at a time as they were picked
    // (/api/license-upload, to stay under Vercel's request size limit). The form sends their ids.
    const files = await findUnclaimedUploads({ ffl: String(form.get("fflUploadId") ?? ""), sot: String(form.get("sotUploadId") ?? "") }, await uploadTokenHash());
    if (typeof files === "string") return { error: files };

    const [created] = await db().insert(accessRequests).values({ ...r, fflExpires: r.fflExpires || null, sotNumber: r.sotNumber || null, sotExpires: r.sotExpires || null }).returning({ id: accessRequests.id });
    await claimLicenseUploads(created.id, files.map((f) => f.id));
    await endRequestAccessSession();

    // The request is saved. From here on, email problems are logged, not shown as a failed request.
    const brand = (await getBrands()).find((b) => b.storeKey === r.brandSlug);
    const summary: RequestSummary = { ...r, brandName: brand?.name ?? storeName(r.brandSlug), files };

    const notify = [...(brand?.notificationEmails ?? []), process.env.ADMIN_NOTIFY_EMAIL ?? ""].filter(Boolean);
    if (notify.length) {
      await sendEmail({ to: notify, kind: "access_request.admin", ...(await accessRequestToAdmins(summary)), replyTo: r.email });
    } else {
      reportError("access request", `No one to notify for ${r.brandSlug}: add notification emails to the brand in Sanity or set ADMIN_NOTIFY_EMAIL`);
    }

    if (wantsCopy) {
      const sent = await sendEmail({ to: r.email, kind: "access_request.copy", ...(await accessRequestCopy(summary)) });
      if (!sent.ok) return { ok: true, notice: "Your request was sent, but we couldn't email you a copy. You don't need to do anything else." };
      return { ok: true, notice: `A copy of your request was emailed to ${r.email}.` };
    }
    return { ok: true };
  } catch (err) {
    return failure("request access", err);
  }
}

/** Don't send another reset email to the same account within this window. */
const RESET_COOLDOWN_MS = 2 * 60 * 1000;

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.email().safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { error: "Enter a valid email address." };
  const email = parsed.data;
  // Per network only, so the reply still says nothing about whether the email has an account.
  const limit = await rateLimit(`reset:${await clientKey()}`, 10, 60);
  if (!limit.ok) return { error: tooManyMessage(limit.retryMinutes) };

  // Do the lookup and send after responding, so the reply is the same (and just as fast)
  // whether or not the email has an account. That stops anyone probing for dealer emails.
  after(async () => {
    try {
      const [user] = await db().select().from(users).where(eq(users.email, email));
      if (!user || user.status !== "active") return;
      if (user.passwordResetRequestedAt && Date.now() - user.passwordResetRequestedAt.getTime() < RESET_COOLDOWN_MS) return;
      await db().update(users).set({ passwordResetRequestedAt: new Date() }).where(eq(users.id, user.id));
      const token = await issueSetupToken(user.id, RESET_LINK_TTL_MS);
      const resetUrl = appUrl(`/set-password?token=${token}&reset=1`);
      await sendEmail({ to: user.email, kind: "password.reset", sensitive: true, ...(await passwordReset({ name: user.name, resetUrl, minutes: RESET_LINK_TTL_MS / 60000 })) });
    } catch (err) {
      reportError("password reset", err);
    }
  });
  return { ok: true };
}

export async function setPassword(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const problem = await passwordProblem(password);
  if (problem) return { error: problem };
  if (password !== confirm) return { error: "The passwords don't match." };

  let user: User | null;
  let needsCode = false;
  try {
    const limit = await rateLimit(`setpw:${await clientKey()}`, 20, 60);
    if (!limit.ok) return { error: tooManyMessage(limit.retryMinutes) };
    user = await findUserBySetupToken(token);
    if (!user) return { error: "This link has expired or was already used. Use \"Forgot password\" on the sign-in page to get a new one." };
    // Now that we know whose password it is, also reject one containing their email.
    const personal = await passwordProblem(password, { email: user.email, name: user.name });
    if (personal) return { error: personal };
    // New password: sign out every other device that was using the old one.
    const updated = await signOutOtherSessions(user.id, {
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      setupTokenHash: null,
      setupTokenExpires: null,
    });
    // An emailed link proves the inbox, not the phone, so 2FA accounts still need their code.
    needsCode = twoFactorEnabled(updated);
    if (needsCode) await startTwoFactor(updated, "");
    else await startSession(updated);
  } catch (err) {
    return failure("set password", err);
  }

  // First password → onboarding email. Otherwise it's a change, so send a security notice.
  const firstTime = !user.passwordHash;
  const { email, name, role } = user;
  after(async () => {
    try {
      if (firstTime && role === "dealer") await sendEmail({ to: email, kind: "onboarding.ready", ...(await accountReady({ name })) });
      else if (!firstTime) await sendEmail({ to: email, kind: "password.changed", ...(await passwordChanged({ name })) });
    } catch (err) {
      reportError("set password email", err);
    }
  });
  redirect(needsCode ? "/login/verify" : homeFor(user));
}
