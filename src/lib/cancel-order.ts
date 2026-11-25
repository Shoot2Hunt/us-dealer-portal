import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, orders, payments, storeOrders } from "@/lib/db";
import { getTransactionStatus, voidTransaction } from "@/lib/authnet";
import { setWooOrderStatus } from "@/lib/woo/orders";
import { isStoreKey } from "@/lib/woo/stores";
import { usd } from "@/lib/money";

/** Payments where money was taken (or is being taken) through Authorize.net. */
const LIVE = ["authorized", "captured", "pending_settlement"] as const;
/** Amounts still owed but not paid: nothing to give back, just stop asking for them. */
const OWED = ["awaiting_check", "invoiced"] as const;
/** Authorize.net statuses meaning the money is already back (or was never taken). */
const ALREADY_UNDONE = new Set(["voided", "refundSettledSuccessfully", "refundPendingSettlement", "declined", "returnedItem", "expired", "couldNotVoid"]);
/** Woo statuses that count as cancelled. */
const WOO_DONE = new Set(["cancelled", "refunded", "failed", "trash"]);

export type CancelResult = { ok: boolean; done: string[]; problems: string[] };

/**
 * Cancel a portal order: void its card/ACH payments in Authorize.net (or record a void or
 * refund already made there), drop amounts still owed, cancel each brand's WooCommerce
 * order, and mark the portal order cancelled.
 *
 * A payment that can't be voided (it has settled) stops the cancel, unless `alreadyRefunded`
 * says it was refunded in Authorize.net by hand.
 */
export async function cancelPortalOrder(orderId: string, opts: { alreadyRefunded?: boolean; by: string }): Promise<CancelResult> {
  const done: string[] = [];
  const problems: string[] = [];
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, done, problems: ["Order not found."] };

  const ps = await db().select().from(payments).where(eq(payments.orderId, orderId));
  const markVoided = (id: number, note: string) =>
    db().update(payments).set({ status: "voided", error: note, updatedAt: new Date() }).where(eq(payments.id, id));

  // 1. Money.
  for (const p of ps.filter((x) => (LIVE as readonly string[]).includes(x.status))) {
    const label = `${p.method === "ach" ? "ACH" : "Card"} ${usd(Number(p.amount))}${p.last4 ? ` ending ${p.last4}` : ""}`;
    if (!p.transId) {
      await markVoided(p.id, `Cancelled by ${opts.by}`);
      done.push(`${label}: marked voided`);
      continue;
    }
    const status = await getTransactionStatus(p.transId);
    if (status && ALREADY_UNDONE.has(status)) {
      await markVoided(p.id, `Already ${status} in Authorize.net; order cancelled by ${opts.by}`);
      done.push(`${label}: already ${status === "voided" ? "voided" : "refunded"} in Authorize.net`);
      continue;
    }
    const r = await voidTransaction(p.transId);
    if (r.ok || /already been voided/i.test(r.error ?? "")) {
      await markVoided(p.id, `Voided by ${opts.by}`);
      done.push(`${label}: voided in Authorize.net (not charged)`);
    } else if (opts.alreadyRefunded) {
      await markVoided(p.id, `Refunded in Authorize.net by hand; order cancelled by ${opts.by}`);
      done.push(`${label}: recorded as refunded in Authorize.net`);
    } else {
      problems.push(
        `${label} (transaction ${p.transId}) couldn't be voided: ${r.error ?? "no reason given"}. If it has settled, refund it in Authorize.net, then cancel again with "Already refunded" ticked.`,
      );
    }
  }
  if (problems.length) return { ok: false, done, problems };

  const owed = ps.filter((x) => (OWED as readonly string[]).includes(x.status));
  if (owed.length) {
    await db().update(payments).set({ status: "voided", error: `Order cancelled by ${opts.by}`, updatedAt: new Date() }).where(inArray(payments.id, owed.map((x) => x.id)));
    done.push(`${owed.length} unpaid amount${owed.length === 1 ? "" : "s"} no longer owed`);
  }

  // 2. Each brand's WooCommerce order (stock goes back when Woo cancels it).
  const sos = await db().select().from(storeOrders).where(eq(storeOrders.orderId, orderId));
  for (const so of sos) {
    if (!so.wooOrderId || !isStoreKey(so.store) || WOO_DONE.has(so.wooStatus ?? "")) continue;
    try {
      await setWooOrderStatus(so.store, so.wooOrderId, "cancelled", `Cancelled from the dealer portal by ${opts.by}.`);
      await db().update(storeOrders).set({ wooStatus: "cancelled", updatedAt: new Date() }).where(eq(storeOrders.id, so.id));
      done.push(`WooCommerce order #${so.wooOrderId} cancelled`);
    } catch (err) {
      problems.push(`Couldn't cancel WooCommerce order #${so.wooOrderId} (${so.store}): ${err instanceof Error ? err.message : String(err)}. Cancel it in WooCommerce.`);
    }
  }

  // 3. The portal order.
  await db().update(orders).set({ status: "cancelled", invoiceOpen: false }).where(eq(orders.id, orderId));
  done.push(`Order #${order.number} marked cancelled`);
  return { ok: problems.length === 0, done, problems };
}

/**
 * From the Woo webhook: once every brand's part of a portal order is cancelled in
 * WooCommerce, mark the portal order cancelled and stop asking for unpaid amounts.
 * Card/ACH money is not touched here; it's listed on the admin order page to void or refund.
 */
export async function cancelIfAllStoresCancelled(orderId: string) {
  const sos = await db().select().from(storeOrders).where(eq(storeOrders.orderId, orderId));
  if (!sos.length || !sos.every((s) => !s.wooOrderId || WOO_DONE.has(s.wooStatus ?? ""))) return false;
  await db()
    .update(payments)
    .set({ status: "voided", error: "Order cancelled in WooCommerce", updatedAt: new Date() })
    .where(and(eq(payments.orderId, orderId), inArray(payments.status, [...OWED])));
  await db().update(orders).set({ status: "cancelled", invoiceOpen: false }).where(eq(orders.id, orderId));
  return true;
}
