"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, users } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { addressSchema } from "@/lib/orders";
import { getPaymentSettings } from "@/sanity/content";
import { authnetConfig } from "@/lib/authnet";
import { errorMessage, reportError } from "@/lib/errors";

export type BillingState = { ok?: boolean; message?: string; error?: string } | undefined;

const FIELDS = ["firstName", "lastName", "company", "address1", "address2", "city", "state", "postcode", "phone"] as const;
const LABEL: Record<string, string> = {
  firstName: "First name", lastName: "Last name", company: "Business", address1: "Street address", address2: "Apt, suite, unit",
  city: "City", state: "State", postcode: "ZIP code", phone: "Phone", billingEmail: "Billing email",
};

/** Save the dealer's billing name, address, email and preferred payment method. */
export async function saveBillingDetails(_: BillingState, form: FormData): Promise<BillingState> {
  const user = await requireUser();
  const sameAsShipping = form.get("sameAsShipping") === "on";

  let billingAddress = null;
  if (!sameAsShipping) {
    const raw = Object.fromEntries(FIELDS.map((k) => [k, String(form.get(k) ?? "").trim() || undefined]));
    const parsed = addressSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path[0] ?? "");
      // Our own messages (ZIP, state, phone) read well as-is; zod's generic ones get the field name.
      return { error: issue?.code === "custom" || issue?.code === "invalid_format" ? issue.message : `${LABEL[field] ?? "Billing address"}: please fill this in correctly.` };
    }
    billingAddress = { ...parsed.data, state: parsed.data.state.toUpperCase() };
  } else if (!user.shippingAddress) {
    return { error: "You don't have a shipping address saved yet. Enter a billing address, or add a shipping address on your Account page." };
  }

  const emailRaw = String(form.get("billingEmail") ?? "").trim();
  const email = emailRaw ? z.email().max(200).safeParse(emailRaw.toLowerCase()) : null;
  if (email && !email.success) return { error: "Billing email: enter a valid email address, e.g. ap@yourstore.com." };

  // Only methods the dealer can actually use at checkout.
  const settings = await getPaymentSettings();
  const online = authnetConfig().ready;
  const allowed = new Set<string>([
    ...(settings.enableCard && online ? ["card"] : []),
    ...(settings.enableAch && online ? ["ach"] : []),
    ...(settings.enableCheck ? ["check"] : []),
    ...(settings.enableTerms && user.paymentTermsDays !== null ? ["terms"] : []),
  ]);
  const preferred = String(form.get("preferredPaymentMethod") ?? "");
  if (preferred && !allowed.has(preferred)) return { error: "That payment method isn't available on your account." };

  try {
    await db()
      .update(users)
      .set({
        billingAddress,
        billingEmail: email?.success ? email.data : null,
        preferredPaymentMethod: preferred ? (preferred as "card" | "ach" | "check" | "terms") : null,
      })
      .where(eq(users.id, user.id));
  } catch (err) {
    reportError("save billing details", err);
    return { error: `Couldn't save your billing details. Please try again. (${errorMessage(err).slice(0, 80)})` };
  }
  revalidatePath("/billing");
  return { ok: true, message: "Billing details saved." };
}
