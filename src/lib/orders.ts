import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { phoneField } from "@/lib/phone";
import { cardholderSchema } from "@/lib/cardholder";
import {
  db,
  inventory,
  orderLines,
  orders,
  payments,
  storeOrders,
  type Address,
  type User,
} from "@/lib/db";
import { authnetConfig, authorizeCard, captureAuthorized, debitBank, voidTransaction, type OpaqueData } from "@/lib/authnet";
import { licenseProblems } from "@/lib/auth/session";
import { loadCatalogContext, shippingBlock, toCatalogItem } from "@/lib/catalog";
import { getPaymentSettings } from "@/sanity/content";
import { refreshProduct } from "@/lib/woo/sync";
import { createWooOrder, setWooOrderStatus } from "@/lib/woo/orders";
import { evaluateDiscount } from "@/lib/discounts";
import { isStoreKey, storeName, type StoreKey } from "@/lib/woo/stores";
import { adminNotifyEmails, appUrl, sendEmail } from "@/lib/email";
import { addDays, balanceOf, formatDue, getTermsStatus, todayIso } from "@/lib/invoices";
import { billingAddressFor, billingRecipients, cardBillTo } from "@/lib/billing";

// Every field has an upper bound: these values go to WooCommerce and into emails.
export const addressSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  company: z.string().trim().max(120).optional(),
  address1: z.string().trim().min(1).max(120),
  address2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().regex(/^[A-Za-z]{2}$/, "Use the 2-letter state code"),
  postcode: z.string().trim().regex(/^[0-9]{5}(-[0-9]{4})?$/, "Enter a 5-digit ZIP code"),
  phone: phoneField,
});

const opaque = z.object({ dataDescriptor: z.string().max(100), dataValue: z.string().max(4000) });

export const checkoutSchema = z.object({
  // Bounded so totals stay well inside safe integer cents.
  lines: z.array(z.object({ id: z.number().int().positive(), quantity: z.number().int().min(1).max(10_000) })).min(1).max(200),
  shipping: addressSchema,
  poNumber: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(1000).optional(),
  /** One discount code per order (Studio → Discount codes). */
  discountCode: z.string().trim().max(30).optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(["card", "ach", "check", "terms"]),
        amount: z.number().positive().max(10_000_000),
        token: opaque.optional(),
        /** Card payments: the name on the card and its address. */
        cardholder: cardholderSchema.optional(),
      }),
    )
    .min(1)
    .max(5),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CheckoutResult = { ok: true; orderId: string } | { ok: false; error: string };

const cents = (n: number) => Math.round(n * 100);
const dollars = (c: number) => (c / 100).toFixed(2);

export async function placeOrder(user: User, input: CheckoutInput): Promise<CheckoutResult> {
  const problems = licenseProblems(user);
  if (problems.length) return { ok: false, error: problems.join(" ") };

  // 1. Re-check stock live against each store before taking money.
  const ids = input.lines.map((l) => l.id);
  const before = await db().select().from(inventory).where(inArray(inventory.id, ids));
  if (before.length !== new Set(ids).size) return { ok: false, error: "Some items are no longer available. Refresh your cart." };
  const products = new Map(before.map((r) => [`${r.store}:${r.productId}`, r]));
  for (const r of products.values()) {
    if (isStoreKey(r.store)) await refreshProduct(r.store, r.productId);
  }
  const rows = await db().select().from(inventory).where(inArray(inventory.id, ids));
  // Includes the dealer's volume tier, so checkout charges exactly what the inventory page showed.
  const ctx = await loadCatalogContext(user);

  // 2. Price and validate every line.
  type Line = { store: StoreKey; productId: number; variationId: number; sku: string | null; name: string; categories: string[]; quantity: number; unitCents: number; discountCents: number };
  const lines: Line[] = [];
  for (const l of input.lines) {
    const row = rows.find((r) => r.id === l.id);
    // Rows are keyed by product+variation, so a re-synced item keeps its id.
    if (!row || !isStoreKey(row.store)) return { ok: false, error: "An item in your cart was removed from the store." };
    const item = toCatalogItem(row, user, ctx);
    if (!item) return { ok: false, error: "An item in your cart is no longer offered to dealers." };
    if (user.allowedBrands?.length && !user.allowedBrands.includes(item.store)) return { ok: false, error: `${item.name} isn't available on your account.` };
    if (item.restriction) return { ok: false, error: `${item.name}: ${item.restriction}.` };
    if (item.dealerPrice === null) return { ok: false, error: `${item.name} has no dealer price yet.` };
    if (l.quantity < item.minQuantity) return { ok: false, error: `${item.name} has a minimum of ${item.minQuantity}.` };
    if (!item.inStock) return { ok: false, error: `${item.name} just sold out.` };
    if (item.stockQuantity !== null && item.stockStatus !== "onbackorder" && l.quantity > item.stockQuantity) {
      return { ok: false, error: `Only ${item.stockQuantity} of ${item.name} left.` };
    }
    const blocked = shippingBlock(item, input.shipping.state, ctx);
    if (blocked) return { ok: false, error: blocked };
    lines.push({ store: row.store, productId: row.productId, variationId: row.variationId, sku: row.sku, name: row.name, categories: row.categories, quantity: l.quantity, unitCents: cents(item.dealerPrice), discountCents: 0 });
  }
  const subtotalCents = lines.reduce((s, l) => s + l.unitCents * l.quantity, 0);

  // Discount code: checked again here (the checkout preview is only a preview) and spread
  // across the qualifying lines, so each brand's WooCommerce order matches what was charged.
  let discount: { code: string; cents: number } | null = null;
  if (input.discountCode) {
    const r = await evaluateDiscount(input.discountCode, user, lines.map((l, key) => ({ ...l, key })));
    if (!r.ok) return { ok: false, error: `Discount code: ${r.error}` };
    lines.forEach((l, key) => (l.discountCents = r.perLine.get(key) ?? 0));
    discount = { code: r.code, cents: r.discountCents };
  }
  const totalCents = subtotalCents - (discount?.cents ?? 0);

  // 3. Validate the payment plan against the admin's payment settings.
  const settings = await getPaymentSettings();
  const parts = input.payments;
  if (parts.length > 1 && !settings.allowSplit) return { ok: false, error: "Split payments are turned off." };
  if (parts.length > settings.maxSplitParts) return { ok: false, error: `Use at most ${settings.maxSplitParts} payment methods.` };
  const online = authnetConfig().ready;
  const termsParts = parts.filter((p) => p.method === "terms");
  if (termsParts.length > 1) return { ok: false, error: "Use \"Invoice me\" only once per order." };
  const terms = termsParts.length ? await getTermsStatus(user, settings.enableTerms) : null;
  if (terms) {
    if (!terms.approved) return { ok: false, error: "Your account isn't set up for invoicing. Choose another payment method." };
    if (!terms.available) return { ok: false, error: terms.reason ?? "Invoicing isn't available on your account right now." };
    const amount = cents(termsParts[0].amount);
    if (terms.creditLimit !== null && cents(terms.owed) + amount > cents(terms.creditLimit)) {
      return { ok: false, error: `That would put you over your $${terms.creditLimit.toFixed(2)} credit limit ($${terms.owed.toFixed(2)} already owed). Pay part by card, ACH or check.` };
    }
  }
  for (const p of parts) {
    if (p.method === "terms") continue;
    if (p.method !== "check" && !online) return { ok: false, error: "Card and bank payments aren't available right now. Please pay by check or contact us." };
    if (p.method === "card" && !settings.enableCard) return { ok: false, error: "Card payments are turned off." };
    if (p.method === "card" && !p.cardholder) return { ok: false, error: "Enter the name on the card and the card's address." };
    if (p.method === "ach" && !settings.enableAch) return { ok: false, error: "ACH payments are turned off." };
    if (p.method === "check" && !settings.enableCheck) return { ok: false, error: "Check payments are turned off." };
    if (p.method !== "check" && !p.token) return { ok: false, error: "Payment details are missing." };
  }
  if (parts.reduce((s, p) => s + cents(p.amount), 0) !== totalCents) {
    return { ok: false, error: `Payments must add up to the order total of $${dollars(totalCents)}.` };
  }

  // 4. Create the portal order. Anything left unpaid (terms or a mailed check) gets a due date
  //    and shows on the dealer's Billing page.
  const address: Address = input.shipping;
  const dueDate = terms?.approved ? terms.dueDate : parts.some((p) => p.method === "check") ? addDays(todayIso(), settings.checkDueDays) : null;
  const [order] = await db()
    .insert(orders)
    .values({
      userId: user.id, status: "awaiting_payment", total: dollars(totalCents), shippingAddress: address, poNumber: input.poNumber, notes: input.notes,
      discountCode: discount?.code ?? null, discountTotal: dollars(discount?.cents ?? 0), dueDate,
    })
    .returning();
  await db().insert(orderLines).values(
    lines.map((l) => ({ orderId: order.id, store: l.store, productId: l.productId, variationId: l.variationId, sku: l.sku, name: l.name, quantity: l.quantity, unitPrice: dollars(l.unitCents), discount: dollars(l.discountCents) })),
  );

  // 5. Take payment. Cards are authorized first, then eChecks debited, then cards captured,
  //    so any decline can be rolled back before the dealer is charged.
  const txCtx = { invoiceNumber: `DP${order.number}`, description: `Dealer portal order #${order.number}`, email: user.billingEmail ?? user.email, billTo: billingAddressFor(user), shipTo: address };
  type Done = { method: "card" | "ach" | "check" | "terms"; amount: number; transId?: string; last4?: string; status: (typeof payments.$inferInsert)["status"]; error?: string };
  const done: Done[] = [];
  const rollback = async () => {
    // Void works on anything not yet settled, including captured cards.
    for (const d of done) if (d.transId && ["authorized", "captured", "pending_settlement"].includes(d.status)) await voidTransaction(d.transId);
  };
  const fail = async (error: string, declined: Done) => {
    await rollback();
    await db().insert(payments).values(
      [...done.map((d) => ({ ...d, status: d.transId ? ("voided" as const) : d.status })), declined].map((d) => ({
        orderId: order.id, method: d.method, amount: d.amount.toFixed(2), status: d.status, transId: d.transId, last4: d.last4, error: d.error,
      })),
    );
    await db().update(orders).set({ status: "failed" }).where(eq(orders.id, order.id));
    return { ok: false as const, error };
  };

  for (const p of parts.filter((x) => x.method === "card")) {
    const r = await authorizeCard(p.amount, p.token as OpaqueData, { ...txCtx, billTo: cardBillTo(user, p.cardholder) }, order.id.replace(/-/g, ""));
    if (!r.ok) return fail(`Card declined: ${r.error}`, { method: "card", amount: p.amount, status: "declined", transId: r.transId, error: r.error });
    done.push({ method: "card", amount: p.amount, transId: r.transId, last4: r.last4, status: "authorized", error: r.heldForReview ? "Held for review in Authorize.net" : undefined });
  }
  for (const p of parts.filter((x) => x.method === "ach")) {
    const r = await debitBank(p.amount, p.token as OpaqueData, txCtx, order.id.replace(/-/g, ""));
    if (!r.ok) return fail(`Bank payment declined: ${r.error}`, { method: "ach", amount: p.amount, status: "declined", transId: r.transId, error: r.error });
    done.push({ method: "ach", amount: p.amount, transId: r.transId, last4: r.last4, status: "pending_settlement" });
  }
  for (const d of done.filter((x) => x.method === "card" && !x.error)) {
    const r = await captureAuthorized(d.transId!, d.amount);
    if (!r.ok) return fail(`Card capture failed: ${r.error}`, { ...d, status: "declined", error: r.error });
    d.status = "captured";
  }
  for (const p of parts.filter((x) => x.method === "check")) done.push({ method: "check", amount: p.amount, status: "awaiting_check" });
  for (const p of termsParts) done.push({ method: "terms", amount: p.amount, status: "invoiced" });

  await db().insert(payments).values(
    done.map((d) => ({ orderId: order.id, method: d.method, amount: d.amount.toFixed(2), status: d.status, transId: d.transId, last4: d.last4, error: d.error })),
  );
  const fullyPaid = done.every((d) => d.status === "captured");
  // Net terms ship now and are paid later; checks and eChecks wait until the money clears.
  const shipNow = done.every((d) => d.status === "captured" || d.status === "invoiced");
  await db()
    .update(orders)
    .set({ status: shipNow ? "processing" : "awaiting_payment", invoiceOpen: termsParts.length > 0 })
    .where(eq(orders.id, order.id));

  // 6. One WooCommerce order per brand. Payment is already taken, so failures here are
  //    recorded for an admin to retry rather than shown as a failed checkout.
  const METHOD_NAME = { ach: "ACH", card: "Card", check: "Check", terms: "Invoice" } as const;
  const summary = done
    .map((d) => `${METHOD_NAME[d.method]} $${d.amount.toFixed(2)}${d.last4 ? ` (…${d.last4})` : ""}${d.method === "terms" && dueDate ? ` (Net ${user.paymentTermsDays}, due ${formatDue(dueDate)})` : ""}`)
    .join(" + ");
  const byStore = Map.groupBy(lines, (l) => l.store);
  for (const [store, storeLines] of byStore) {
    // What this brand is owed: its lines after their share of any discount code.
    const subtotal = dollars(storeLines.reduce((s, l) => s + l.unitCents * l.quantity - l.discountCents, 0));
    try {
      const wooOrder = await createWooOrder({
        storeKey: store, user, address, portalOrderId: order.id, portalOrderNumber: order.number, poNumber: input.poNumber, paid: fullyPaid, release: shipNow,
        paymentSummary: shipNow ? (fullyPaid ? summary : `${summary} — OK to ship, dealer pays the invoice through the portal`) : `${summary} — waiting for payment to clear`,
        discountCode: discount?.code,
        lines: storeLines.map((l) => ({ productId: l.productId, variationId: l.variationId, quantity: l.quantity, unitPrice: dollars(l.unitCents), discount: dollars(l.discountCents) })),
      });
      await db().insert(storeOrders).values({ orderId: order.id, store, subtotal, wooOrderId: wooOrder.id, wooStatus: wooOrder.status });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await db().insert(storeOrders).values({ orderId: order.id, store, subtotal, error });
      await sendEmail({ kind: "order.store_failed", to: await adminNotifyEmails(), subject: `Action needed: order #${order.number} didn't reach ${storeName(store)}`, text: `${error}\n\n${appUrl(`/admin/orders/${order.id}`)}` });
    }
  }

  const invoiceNote = termsParts.length && dueDate
    ? ` $${termsParts[0].amount.toFixed(2)} is invoiced, due ${formatDue(dueDate)}. Pay any time on the Billing page: ${appUrl("/billing")}`
    : shipNow ? "" : " It will ship once your payment clears.";
  await notifyOrderPlaced(user, order.id, order.number, dollars(totalCents), [...byStore.keys()], invoiceNote, ctx.brands);
  return { ok: true, orderId: order.id };
}

async function notifyOrderPlaced(user: User, orderId: string, number: number, total: string, stores: string[], note: string, brands: { storeKey: string; notificationEmails?: string[] }[]) {
  const link = appUrl(`/orders/${orderId}`);
  await sendEmail({
    kind: "order.confirmation",
    to: billingRecipients(user),
    subject: `Order #${number} received`,
    text: `Thanks — we received order #${number} for $${total}.${note}\n\n${link}`,
  });
  const brandEmails = brands.filter((b) => stores.includes(b.storeKey)).flatMap((b) => b.notificationEmails ?? []);
  await sendEmail({ kind: "order.brand_notice", to: brandEmails, subject: `New dealer order #${number} from ${user.company ?? user.name}`, text: appUrl(`/admin/orders/${orderId}`) });
}

/**
 * Call after any payment on an order changes (taken, settled, check received). Closes a
 * net-terms invoice once it's paid and cleared, and releases a held order to the brands
 * (Woo → Processing) once nothing is left owing except an approved invoice amount.
 */
export async function releaseIfPaid(orderId: string) {
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId));
  if (!order) return false;
  const ps = await db().select().from(payments).where(eq(payments.orderId, orderId));
  const b = balanceOf(order, ps);
  if (order.invoiceOpen && b.balance <= 0 && b.clearing <= 0) {
    await db().update(orders).set({ invoiceOpen: false }).where(eq(orders.id, orderId));
  }
  // Checks still in the mail, eChecks still clearing or an unpaid return keep it on hold.
  const unapproved = b.balance - b.invoiced;
  if (unapproved > 0 || b.clearing > 0) return false;
  if (order.status !== "awaiting_payment" && order.status !== "payment_problem") return false;
  await db().update(orders).set({ status: "processing" }).where(eq(orders.id, orderId));
  const sos = await db().select().from(storeOrders).where(eq(storeOrders.orderId, orderId));
  for (const so of sos) {
    // Only orders the portal put on hold: never move a shipped (completed) order back.
    if (so.wooOrderId && isStoreKey(so.store) && (so.wooStatus === "on-hold" || so.wooStatus === "pending")) {
      await setWooOrderStatus(so.store, so.wooOrderId, "processing", "Dealer portal: payment cleared — OK to ship.");
      await db().update(storeOrders).set({ wooStatus: "processing", updatedAt: new Date() }).where(eq(storeOrders.id, so.id));
    }
  }
  return true;
}

/** An eCheck came back (insufficient funds, etc.). Hold the order and tell the admins. */
export async function markPaymentProblem(orderId: string, paymentId: number, reason: string) {
  await db().update(payments).set({ status: "returned", error: reason, updatedAt: new Date() }).where(eq(payments.id, paymentId));
  const [order] = await db().update(orders).set({ status: "payment_problem" }).where(eq(orders.id, orderId)).returning();
  const sos = await db().select().from(storeOrders).where(eq(storeOrders.orderId, orderId));
  for (const so of sos) {
    if (so.wooOrderId && isStoreKey(so.store) && so.wooStatus !== "completed") {
      await setWooOrderStatus(so.store, so.wooOrderId, "on-hold", `Dealer portal: payment problem — ${reason}. Do not ship.`);
      await db().update(storeOrders).set({ wooStatus: "on-hold", updatedAt: new Date() }).where(eq(storeOrders.id, so.id));
    }
  }
  await sendEmail({ kind: "order.payment_problem", to: await adminNotifyEmails(), subject: `Payment problem on order #${order?.number}`, text: `${reason}\n\n${appUrl(`/admin/orders/${orderId}`)}` });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An order as `user` may see it, or null. Dealers: their own orders only. Brand admins:
 * only orders that include their brand. Super admins: any order.
 */
export async function getOrderForUser(user: User, orderId: string) {
  if (!UUID.test(orderId)) return null;
  const where = user.role === "dealer" ? and(eq(orders.id, orderId), eq(orders.userId, user.id)) : eq(orders.id, orderId);
  const [order] = await db().select().from(orders).where(where);
  if (!order) return null;
  const [lines, sos, ps] = await Promise.all([
    db().select().from(orderLines).where(eq(orderLines.orderId, orderId)),
    db().select().from(storeOrders).where(eq(storeOrders.orderId, orderId)),
    db().select().from(payments).where(eq(payments.orderId, orderId)),
  ]);
  if (user.role === "brand_admin" && !sos.some((s) => s.store === user.brandSlug)) return null;
  return { order, lines, storeOrders: sos, payments: ps };
}
