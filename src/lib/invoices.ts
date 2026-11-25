import "server-only";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, loginThrottle, orders, payments, type Order, type Payment, type User } from "@/lib/db";
import { authnetConfig, chargeCard, debitBank, type OpaqueData } from "@/lib/authnet";
import { getPaymentSettings } from "@/sanity/content";
import { cardholderSchema, releaseIfPaid } from "@/lib/orders";
import { adminNotifyEmails, appUrl, sendEmail } from "@/lib/email";
import { reportError } from "@/lib/errors";
import { billingAddressFor, billingRecipients, cardBillTo, shippingOnFile } from "@/lib/billing";

/*
 * Invoices are portal orders that still owe money:
 *   - orders placed on net terms ("Invoice me" at checkout), which ship right away, and
 *   - orders waiting for a mailed check.
 * An order's balance is its total minus every payment that has been taken or is clearing.
 * The "check" and "invoice" rows created at checkout are placeholders for what's still owed:
 * when the dealer pays online instead, they're reduced to match (marked "superseded").
 */

/** Rows that record money still owed, not money received. */
export const PLACEHOLDER_STATUSES = ["awaiting_check", "invoiced"] as const;
const PAID_STATUSES = new Set(["captured", "settled", "received"]);
/** Taken but not final yet: counted as paid toward the balance, shown as "clearing". */
const CLEARING_STATUSES = new Set(["authorized", "pending_settlement"]);

/** Due dates and "past due" are counted in the business's own time zone. */
const BUSINESS_TZ = "America/Denver";

export const cents = (n: number | string) => Math.round(Number(n) * 100);
const dollars = (c: number) => (c / 100).toFixed(2);

/** Today as yyyy-mm-dd in the business time zone. */
export function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 864e5);

/** e.g. "Dec 24, 2026" */
export const formatDue = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** What an order has been paid, what's still clearing, and what's left to pay (all in cents). */
export function balanceOf(order: Pick<Order, "total">, ps: Pick<Payment, "status" | "amount">[]) {
  let paid = 0;
  let clearing = 0;
  for (const p of ps) {
    if (PAID_STATUSES.has(p.status)) paid += cents(p.amount);
    else if (CLEARING_STATUSES.has(p.status)) clearing += cents(p.amount);
  }
  const invoiced = ps.filter((p) => p.status === "invoiced").reduce((s, p) => s + cents(p.amount), 0);
  return { paid, clearing, balance: Math.max(0, cents(order.total) - paid - clearing), invoiced };
}

export type Invoice = {
  orderId: string;
  number: number;
  poNumber: string | null;
  orderedOn: string;
  dueDate: string;
  /** True when placed on net terms (the goods ship before payment). */
  terms: boolean;
  total: number;
  paid: number;
  clearing: number;
  balance: number;
  /** Days past the due date; 0 when not past due. */
  daysPastDue: number;
  /** Days until due; negative once past due. */
  daysUntilDue: number;
};

export type InvoiceSummary = {
  invoices: Invoice[];
  pastDue: number;
  current: number;
  clearing: number;
  total: number;
};

/** Every order of this dealer's that still owes money or has a payment clearing, oldest due first. */
export async function getInvoices(userId: string): Promise<InvoiceSummary> {
  const os = await db()
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), or(eq(orders.invoiceOpen, true), inArray(orders.status, ["awaiting_payment", "payment_problem"]))))
    .orderBy(asc(orders.createdAt))
    .limit(500);
  const ps = os.length ? await db().select().from(payments).where(inArray(payments.orderId, os.map((o) => o.id))) : [];
  const byOrder = Map.groupBy(ps, (p) => p.orderId);
  const today = todayIso();

  const invoices: Invoice[] = [];
  for (const o of os) {
    const mine = byOrder.get(o.id) ?? [];
    const b = balanceOf(o, mine);
    if (b.balance <= 0 && b.clearing <= 0) continue;
    const orderedOn = todayIso(o.createdAt);
    const dueDate = o.dueDate ?? orderedOn;
    const until = daysBetween(today, dueDate);
    invoices.push({
      orderId: o.id,
      number: o.number,
      poNumber: o.poNumber,
      orderedOn,
      dueDate,
      terms: mine.some((p) => p.method === "terms"),
      total: cents(o.total) / 100,
      paid: b.paid / 100,
      clearing: b.clearing / 100,
      balance: b.balance / 100,
      daysPastDue: b.balance > 0 && until < 0 ? -until : 0,
      daysUntilDue: until,
    });
  }
  invoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number - b.number);
  const sumOf = (list: Invoice[], f: (i: Invoice) => number) => Math.round(list.reduce((s, i) => s + cents(f(i)), 0)) / 100;
  return {
    invoices,
    pastDue: sumOf(invoices.filter((i) => i.daysPastDue > 0), (i) => i.balance),
    current: sumOf(invoices.filter((i) => i.daysPastDue === 0), (i) => i.balance),
    clearing: sumOf(invoices, (i) => i.clearing),
    total: sumOf(invoices, (i) => i.balance),
  };
}

export type TermsStatus =
  | { approved: false }
  | { approved: true; days: number; dueDate: string; available: boolean; reason?: string; creditLimit: number | null; owed: number };

/** Whether the dealer can choose "Invoice me" at checkout right now, and why not. */
export async function getTermsStatus(user: User, enabled: boolean): Promise<TermsStatus> {
  if (!enabled || user.paymentTermsDays === null) return { approved: false };
  const s = await getInvoices(user.id);
  const owed = s.invoices.filter((i) => i.terms).reduce((sum, i) => sum + cents(i.balance), 0) / 100;
  const creditLimit = user.creditLimit === null ? null : Number(user.creditLimit);
  const base = { approved: true as const, days: user.paymentTermsDays, dueDate: addDays(todayIso(), user.paymentTermsDays), creditLimit, owed };
  if (s.pastDue > 0) {
    return { ...base, available: false, reason: `You have $${s.pastDue.toFixed(2)} past due. Pay it on the Billing page to order on terms again.` };
  }
  if (creditLimit !== null && owed >= creditLimit) {
    return { ...base, available: false, reason: `You've reached your $${creditLimit.toFixed(2)} credit limit. Pay open invoices on the Billing page to order on terms again.` };
  }
  return { ...base, available: true };
}

/**
 * After money comes in, shrink the order's check/invoice placeholders so together they
 * equal what's still owed. Newest placeholders shrink first. A partly-covered placeholder
 * is split into the paid part ("superseded") and what's still owed, so amounts still add up.
 */
export async function reconcilePlaceholders(orderId: string) {
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId));
  if (!order) return;
  const ps = await db().select().from(payments).where(eq(payments.orderId, orderId));
  const { balance } = balanceOf(order, ps);
  const holders = ps.filter((p) => (PLACEHOLDER_STATUSES as readonly string[]).includes(p.status)).sort((a, b) => b.id - a.id);
  let excess = holders.reduce((s, p) => s + cents(p.amount), 0) - balance;
  for (const h of holders) {
    if (excess <= 0) break;
    const amount = cents(h.amount);
    if (amount <= excess) {
      await db().update(payments).set({ status: "superseded", updatedAt: new Date() }).where(eq(payments.id, h.id));
      excess -= amount;
    } else {
      await db().update(payments).set({ amount: dollars(amount - excess), updatedAt: new Date() }).where(eq(payments.id, h.id));
      await db().insert(payments).values({ orderId, method: h.method, amount: dollars(excess), status: "superseded" });
      excess = 0;
    }
  }
}

// --- Paying invoices from the Billing page ---

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const payInvoicesSchema = z.object({
  /** Orders to pay, in any order: the money goes to the oldest due date first. */
  orderIds: z.array(z.string().regex(UUID)).min(1).max(200),
  amount: z.number().positive().max(10_000_000),
  method: z.enum(["card", "ach"]),
  token: z.object({ dataDescriptor: z.string().max(100), dataValue: z.string().max(4000) }),
  /** Card payments: the name on the card and its address. */
  cardholder: cardholderSchema.optional(),
});
export type PayInvoicesInput = z.infer<typeof payInvoicesSchema>;
export type PayInvoicesResult = { ok: true; amount: number; clearing: boolean; orders: number[] } | { ok: false; error: string };

/** One payment at a time per dealer, so a double-click can't charge twice. */
async function withPaymentLock<T>(userId: string, fn: () => Promise<T>): Promise<T | null> {
  const key = `lock:invoice-pay:${userId}`;
  const [got] = await db()
    .insert(loginThrottle)
    .values({ key, failures: 0, firstFailureAt: new Date() })
    .onConflictDoUpdate({
      target: loginThrottle.key,
      set: { firstFailureAt: new Date() },
      // A lock left behind by a crashed request expires after 2 minutes.
      setWhere: lt(loginThrottle.firstFailureAt, sql`now() - interval '2 minutes'`),
    })
    .returning({ key: loginThrottle.key });
  if (!got) return null;
  try {
    return await fn();
  } finally {
    await db().delete(loginThrottle).where(eq(loginThrottle.key, key)).catch(() => {});
  }
}

export async function payInvoices(user: User, input: PayInvoicesInput): Promise<PayInvoicesResult> {
  const settings = await getPaymentSettings();
  if (!authnetConfig().ready) return { ok: false, error: "Online payments aren't available right now. Please pay by check or contact us." };
  if (input.method === "card" && !settings.enableCard) return { ok: false, error: "Card payments are turned off." };
  if (input.method === "ach" && !settings.enableAch) return { ok: false, error: "ACH payments are turned off." };
  if (input.method === "card" && !input.cardholder) return { ok: false, error: "Enter the name on the card and the card's address." };

  const result = await withPaymentLock(user.id, async (): Promise<PayInvoicesResult> => {
    // Balances are worked out again here: the page the dealer paid from may be out of date.
    const { invoices } = await getInvoices(user.id);
    const wanted = new Set(input.orderIds);
    const selected = invoices.filter((i) => wanted.has(i.orderId) && i.balance > 0);
    if (!selected.length) return { ok: false, error: "Those invoices are already paid or have a payment clearing. Refresh the page." };
    const owedCents = selected.reduce((s, i) => s + cents(i.balance), 0);
    const amountCents = cents(input.amount);
    if (amountCents > owedCents) return { ok: false, error: `That's more than the $${dollars(owedCents)} owed on the selected invoices.` };
    if (amountCents < 100 && amountCents !== owedCents) return { ok: false, error: "The smallest partial payment is $1.00." };

    // Oldest due date first; the last invoice reached may be paid in part.
    const allocations: { invoice: Invoice; cents: number }[] = [];
    let left = amountCents;
    for (const inv of selected) {
      if (left <= 0) break;
      const c = Math.min(left, cents(inv.balance));
      allocations.push({ invoice: inv, cents: c });
      left -= c;
    }

    const numbers = allocations.map((a) => a.invoice.number);
    const ctx = {
      invoiceNumber: numbers.length === 1 ? `DP${numbers[0]}` : `DPPAY${Date.now().toString(36).toUpperCase()}`,
      description: `Dealer portal invoice payment: ${numbers.map((n) => `#${n}`).join(", ")}`,
      email: user.billingEmail ?? user.email,
      billTo: input.method === "card" ? cardBillTo(user, input.cardholder) : billingAddressFor(user),
      shipTo: shippingOnFile(user),
    };
    const token = input.token as OpaqueData;
    const tx = input.method === "card" ? await chargeCard(amountCents / 100, token, ctx, user.id.replace(/-/g, "")) : await debitBank(amountCents / 100, token, ctx, user.id.replace(/-/g, ""));
    if (!tx.ok) {
      return { ok: false, error: `${input.method === "card" ? "Card" : "Bank payment"} declined: ${tx.error ?? "no reason given"}. You have not been charged.` };
    }

    // The money is taken. Anything failing from here on must reach an admin, not the dealer.
    const status = input.method === "ach" ? ("pending_settlement" as const) : tx.heldForReview ? ("authorized" as const) : ("captured" as const);
    try {
      await db().insert(payments).values(
        allocations.map((a) => ({
          orderId: a.invoice.orderId, method: input.method, amount: dollars(a.cents), status, transId: tx.transId, last4: tx.last4,
          error: tx.heldForReview ? "Held for review in Authorize.net" : null,
        })),
      );
      for (const a of allocations) {
        await reconcilePlaceholders(a.invoice.orderId);
        await releaseIfPaid(a.invoice.orderId);
      }
    } catch (err) {
      reportError("invoice payment record", err, { transId: tx.transId, userId: user.id });
      await sendEmail({
        kind: "invoice.record_failed",
        to: await adminNotifyEmails(),
        subject: `Action needed: invoice payment ${tx.transId} wasn't recorded`,
        text: `${user.company ?? user.name} (${user.email}) paid $${dollars(amountCents)} by ${input.method} (Authorize.net transaction ${tx.transId}) toward orders ${numbers.map((n) => `#${n}`).join(", ")}, but saving it failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const lines = allocations.map((a) => `  Order #${a.invoice.number}: $${dollars(a.cents)}${a.cents < cents(a.invoice.balance) ? ` (partial — $${dollars(cents(a.invoice.balance) - a.cents)} still owed)` : " (paid in full)"}`).join("\n");
    const how = `${input.method === "card" ? "Card" : "ACH"}${tx.last4 ? ` ending ${tx.last4}` : ""}`;
    await sendEmail({
      kind: "invoice.receipt",
      // The dealer and their billing email (accounts payable), if they set one.
      to: billingRecipients(user),
      subject: `Payment received: $${dollars(amountCents)}`,
      text: `Thanks — we received your payment of $${dollars(amountCents)} (${how}).${input.method === "ach" ? " Bank payments take a few business days to clear." : ""}\n\n${lines}\n\n${appUrl("/billing")}`,
    });
    await sendEmail({
      kind: "invoice.payment_notice",
      to: await adminNotifyEmails(),
      subject: `Invoice payment $${dollars(amountCents)} from ${user.company ?? user.name}`,
      text: `${how}, transaction ${tx.transId}\n\n${lines}`,
    });
    return { ok: true, amount: amountCents / 100, clearing: status !== "captured", orders: numbers };
  });
  return result ?? { ok: false, error: "A payment is already being processed. Wait a moment, then refresh the page." };
}
