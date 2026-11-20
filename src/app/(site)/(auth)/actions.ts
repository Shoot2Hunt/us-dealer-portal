"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { accessRequests, db, users, type User } from "@/lib/db";
import {
  checkPassword,
  endSession,
  findUserBySetupToken,
  hashPassword,
  issueSetupToken,
  RESET_LINK_TTL_MS,
  startSession,
} from "@/lib/auth/session";
import { appUrl, sendEmail } from "@/lib/email";
import { accessRequestCopy, accessRequestToAdmins, accountReady, passwordChanged, passwordReset, type RequestSummary } from "@/lib/email-templates";
import { reportError } from "@/lib/errors";
import { getBrands } from "@/sanity/content";
import { isStoreKey, storeName } from "@/lib/woo/stores";
import { readLicenseFile, saveLicenseFiles, type ValidatedLicenseFile } from "@/lib/license-docs";

export type FormState = { error?: string; ok?: boolean; notice?: string } | undefined;

/** Friendly message for unexpected failures, with a code support can look up in the logs. */
const failure = (scope: string, err: unknown): FormState => ({
  error: `Something went wrong on our side. Please try again in a minute. If it keeps happening, contact us and mention reference ${reportError(scope, err)}.`,
});

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");
  let user: User | undefined;
  try {
    [user] = await db().select().from(users).where(eq(users.email, email));
    // Same message for every failure so emails can't be probed.
    if (!user || user.status !== "active" || !user.passwordHash || !(await checkPassword(password, user.passwordHash))) {
      return { error: "That email and password don't match an active dealer account." };
    }
    await startSession(user);
  } catch (err) {
    return failure("login", err);
  }
  // redirect() throws on purpose, so it stays outside the try/catch.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : user.role === "dealer" ? "/inventory" : "/admin");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

const requestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.email("Enter a valid email").transform((s) => s.toLowerCase()),
  company: z.string().trim().min(2, "Enter your company"),
  phone: z.string().trim().optional(),
  brandSlug: z.string().refine(isStoreKey, "Choose a brand"),
  fflNumber: z.string().trim().min(5, "Enter your FFL number"),
  fflExpires: z.string().optional(),
  hasSot: z.boolean(),
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
    fflExpires: form.get("fflExpires") || undefined,
    hasSot: form.get("hasSot") === "on",
    message: form.get("message") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const r = parsed.data;
  const wantsCopy = form.get("sendCopy") === "on";

  try {
    // Optional copies of the FFL and SOT. Validate both before saving anything.
    const files: ValidatedLicenseFile[] = [];
    for (const [field, kind] of [["fflFile", "ffl"], ["sotFile", "sot"]] as const) {
      const file = await readLicenseFile(form.get(field), kind);
      if (typeof file === "string") return { error: file };
      if (file) files.push(file);
    }

    const [created] = await db().insert(accessRequests).values({ ...r, fflExpires: r.fflExpires || null }).returning({ id: accessRequests.id });
    await saveLicenseFiles(created.id, files);

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
  if (password.length < 10) return { error: "Use at least 10 characters." };
  if (password !== confirm) return { error: "The passwords don't match." };

  let user: User | null;
  try {
    user = await findUserBySetupToken(token);
    if (!user) return { error: "This link has expired or was already used. Use \"Forgot password\" on the sign-in page to get a new one." };
    await db()
      .update(users)
      .set({ passwordHash: await hashPassword(password), setupTokenHash: null, setupTokenExpires: null })
      .where(eq(users.id, user.id));
    await startSession(user);
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
  redirect(user.role === "dealer" ? "/inventory" : "/admin");
}
