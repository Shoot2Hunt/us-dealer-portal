"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { accessRequests, db, users } from "@/lib/db";
import {
  checkPassword,
  endSession,
  findUserBySetupToken,
  hashPassword,
  startSession,
} from "@/lib/auth/session";
import { appUrl, sendEmail } from "@/lib/email";
import { getBrands } from "@/sanity/content";
import { isStoreKey, storeName } from "@/lib/woo/stores";

export type FormState = { error?: string; ok?: boolean } | undefined;

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");
  const [user] = await db().select().from(users).where(eq(users.email, email));
  // Same message for every failure so emails can't be probed.
  if (!user || user.status !== "active" || !user.passwordHash || !(await checkPassword(password, user.passwordHash))) {
    return { error: "That email and password don't match an active dealer account." };
  }
  await startSession(user);
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

  await db().insert(accessRequests).values({ ...r, fflExpires: r.fflExpires || null });

  const brand = (await getBrands()).find((b) => b.storeKey === r.brandSlug);
  const notify = [...(brand?.notificationEmails ?? []), process.env.ADMIN_NOTIFY_EMAIL ?? ""].filter(Boolean);
  await sendEmail({
    to: notify,
    subject: `Dealer access request: ${r.company}`,
    text: `${r.name} (${r.email}) from ${r.company} asked for dealer portal access through ${brand?.name ?? storeName(r.brandSlug)}.\n\nFFL: ${r.fflNumber}\nSOT: ${r.hasSot ? "yes" : "no"}\n\nReview it: ${appUrl("/admin")}`,
  });
  return { ok: true };
}

export async function setPassword(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 10) return { error: "Use at least 10 characters." };
  if (password !== confirm) return { error: "The passwords don't match." };
  const user = await findUserBySetupToken(token);
  if (!user) return { error: "This link has expired. Ask your brand contact to send a new one." };
  await db()
    .update(users)
    .set({ passwordHash: await hashPassword(password), setupTokenHash: null, setupTokenExpires: null })
    .where(eq(users.id, user.id));
  await startSession(user);
  redirect(user.role === "dealer" ? "/inventory" : "/admin");
}
