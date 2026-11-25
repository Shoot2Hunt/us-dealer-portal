import "server-only";
import type { Address, User } from "@/lib/db";
import { addressSchema } from "@/lib/orders";

export type PaymentMethod = "card" | "ach" | "check" | "terms";
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "Credit card",
  ach: "ACH (bank account)",
  check: "Mailed check",
  terms: "Invoice me (net terms)",
};

/**
 * Where the dealer is billed: their saved billing address, else their shipping address.
 * The stored value is re-checked so an old or hand-edited row can't break checkout.
 */
export function billingAddressFor(user: User): Address | null {
  const saved = addressSchema.safeParse(user.billingAddress);
  if (saved.success) return saved.data;
  const shipping = addressSchema.safeParse(user.shippingAddress);
  return shipping.success ? shipping.data : null;
}

/**
 * The billTo for a card payment: the name and address typed on the card form, keeping the
 * company and phone from the dealer's billing details. Falls back to the billing address.
 */
export function cardBillTo(user: User, holder: { firstName: string; lastName: string; address1: string; address2?: string; city: string; state: string; postcode: string } | undefined): Address | null {
  const base = billingAddressFor(user);
  if (!holder) return base;
  return { ...holder, company: base?.company ?? user.company ?? undefined, phone: base?.phone ?? user.phone ?? undefined };
}

/** The dealer's saved shipping address, if it's complete. */
export function shippingOnFile(user: User): Address | null {
  const shipping = addressSchema.safeParse(user.shippingAddress);
  return shipping.success ? shipping.data : null;
}

/** Receipts and invoice emails go to the login email plus the billing email, if different. */
export function billingRecipients(user: User): string[] {
  return [...new Set([user.email, user.billingEmail].filter((x): x is string => Boolean(x)).map((x) => x.toLowerCase()))];
}
