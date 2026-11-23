import "server-only";
import { and, count, eq, notInArray } from "drizzle-orm";
import { db, orders, type User } from "@/lib/db";
import { findDiscountCode } from "@/sanity/content";
import { allocateDiscount, inScope, isCurrent } from "@/lib/pricing";

/** A priced cart line, in cents, after sale/promotion/tier pricing. */
export type DiscountLine = { key: number; store: string; categories: string[]; sku: string | null; unitCents: number; quantity: number };

export type DiscountResult =
  | { ok: true; code: string; description?: string; discountCents: number; /** cents off each line, by key */ perLine: Map<number, number> }
  | { ok: false; error: string };

/** Orders in these states don't count as having used a code. */
const NOT_USED = ["failed", "cancelled"] as const;

/**
 * Check a discount code against the cart and work out the discount. Used for the checkout
 * preview and again when the order is placed, so the dealer is charged what they saw.
 * One code per order, applied after sale/promotion/tier prices.
 */
export async function evaluateDiscount(rawCode: string, user: User, lines: DiscountLine[]): Promise<DiscountResult> {
  const doc = await findDiscountCode(rawCode);
  if (!doc) return { ok: false, error: "That code isn't valid." };
  if (doc.startsAt && Date.parse(doc.startsAt) > Date.now()) return { ok: false, error: "That code isn't active yet." };
  if (!isCurrent(null, doc.endsAt)) return { ok: false, error: "That code has expired." };

  const eligible = lines.filter((l) => inScope(doc, l));
  const eligibleCents = eligible.reduce((s, l) => s + l.unitCents * l.quantity, 0);
  if (!eligibleCents) return { ok: false, error: "That code doesn't apply to anything in your cart." };
  if (doc.minSubtotal && eligibleCents < Math.round(doc.minSubtotal * 100)) {
    return { ok: false, error: `That code needs at least $${doc.minSubtotal.toFixed(2)} of qualifying items.` };
  }

  if (doc.maxUses || doc.maxUsesPerDealer) {
    const used = and(eq(orders.discountCode, doc.code), notInArray(orders.status, [...NOT_USED]));
    const [[all], [mine]] = await Promise.all([
      doc.maxUses ? db().select({ n: count() }).from(orders).where(used) : Promise.resolve([{ n: 0 }]),
      doc.maxUsesPerDealer ? db().select({ n: count() }).from(orders).where(and(used, eq(orders.userId, user.id))) : Promise.resolve([{ n: 0 }]),
    ]);
    if (doc.maxUses && (all?.n ?? 0) >= doc.maxUses) return { ok: false, error: "That code has been fully used." };
    if (doc.maxUsesPerDealer && (mine?.n ?? 0) >= doc.maxUsesPerDealer) return { ok: false, error: "You've already used that code." };
  }

  const target =
    doc.type === "percent" ? Math.round((eligibleCents * Math.min(doc.value, 90)) / 100) : Math.min(Math.round(doc.value * 100), eligibleCents);
  const perLine = allocateDiscount(target, eligible);

  const orderCents = lines.reduce((s, l) => s + l.unitCents * l.quantity, 0);
  if (target >= orderCents) return { ok: false, error: "That code covers the whole order. Please contact us to place it." };
  return { ok: true, code: doc.code, description: doc.description, discountCents: target, perLine };
}
