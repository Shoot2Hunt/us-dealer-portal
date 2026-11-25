import "server-only";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, orderLines, orders, payments, storeOrders, type Address, type Order } from "@/lib/db";
import { addressSchema } from "@/lib/orders";
import { cancelPortalOrder } from "@/lib/cancel-order";
import { updateWooOrderDetails, WOO_STATUS_FOR } from "@/lib/woo/orders";
import { isStoreKey, storeName } from "@/lib/woo/stores";
import { usd } from "@/lib/money";

export const ORDER_STATUSES = ["processing", "awaiting_payment", "payment_problem", "failed", "cancelled"] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

/** Payment states where money was taken and not given back: these block a delete. */
const MONEY_HELD = new Set(["authorized", "captured", "pending_settlement", "settled", "received"]);
/** Woo statuses that need no cancelling. */
const WOO_DONE = new Set(["cancelled", "refunded", "failed", "trash"]);

export type BulkResult = { done: string[]; problems: string[] };

/** Push a status (and optionally address/PO) to each brand's WooCommerce order for this portal order. */
async function pushToWoo(order: Order, changes: Parameters<typeof updateWooOrderDetails>[2], by: string, problems: string[]) {
  const sos = await db().select().from(storeOrders).where(eq(storeOrders.orderId, order.id));
  for (const so of sos) {
    if (!so.wooOrderId || !isStoreKey(so.store)) continue;
    // Don't reopen a brand's order that is already cancelled or refunded.
    const status = changes.status && WOO_DONE.has(so.wooStatus ?? "") && changes.status !== "cancelled" ? undefined : changes.status;
    try {
      await updateWooOrderDetails(so.store, so.wooOrderId, { ...changes, status }, `Updated from the dealer portal by ${by}.`);
      if (status) await db().update(storeOrders).set({ wooStatus: status, updatedAt: new Date() }).where(eq(storeOrders.id, so.id));
    } catch (err) {
      problems.push(`#${order.number}: couldn't update ${storeName(so.store)}'s WooCommerce order #${so.wooOrderId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Set the status of several orders. "Cancelled" goes through the full cancel (void payments,
 * cancel WooCommerce orders); other statuses change the portal status and, if asked, the
 * brands' WooCommerce orders. No money moves for those.
 */
export async function bulkSetStatus(ids: string[], status: OrderStatusValue, opts: { syncWoo: boolean; by: string }): Promise<BulkResult> {
  const done: string[] = [];
  const problems: string[] = [];
  const rows = await db().select().from(orders).where(inArray(orders.id, ids));
  for (const order of rows) {
    if (status === "cancelled") {
      const r = await cancelPortalOrder(order.id, { by: opts.by });
      if (r.ok) done.push(`#${order.number} cancelled`);
      problems.push(...r.problems.map((p) => `#${order.number}: ${p}`));
      continue;
    }
    if (order.status === status) continue;
    await db().update(orders).set({ status }).where(eq(orders.id, order.id));
    if (opts.syncWoo && WOO_STATUS_FOR[status]) await pushToWoo(order, { status: WOO_STATUS_FOR[status]! }, opts.by, problems);
    done.push(`#${order.number} → ${status.replace("_", " ")}`);
  }
  return { done, problems };
}

/**
 * Delete orders for good. Each one is cancelled first (voiding any card/ACH payment and
 * cancelling the WooCommerce orders); an order whose money can't be given back automatically
 * (a settled charge, a received check) is kept, with the reason.
 */
export async function deleteOrders(ids: string[], opts: { by: string }): Promise<BulkResult & { snapshots: unknown[] }> {
  const done: string[] = [];
  const problems: string[] = [];
  const snapshots: unknown[] = [];
  const rows = await db().select().from(orders).where(inArray(orders.id, ids));
  for (const order of rows) {
    let ps = await db().select().from(payments).where(eq(payments.orderId, order.id));
    const sos = await db().select().from(storeOrders).where(eq(storeOrders.orderId, order.id));
    const needsCancel = order.status !== "cancelled" || ps.some((p) => MONEY_HELD.has(p.status)) || sos.some((s) => s.wooOrderId && !WOO_DONE.has(s.wooStatus ?? ""));
    if (needsCancel) {
      const r = await cancelPortalOrder(order.id, { by: opts.by });
      if (r.problems.length) {
        problems.push(...r.problems.map((p) => `#${order.number} not deleted: ${p}`));
        continue;
      }
      ps = await db().select().from(payments).where(eq(payments.orderId, order.id));
    }
    const held = ps.filter((p) => MONEY_HELD.has(p.status));
    if (held.length) {
      problems.push(
        `#${order.number} not deleted: ${held.map((p) => `${p.method} ${usd(Number(p.amount))} (${p.status})`).join(", ")} was paid and hasn't been refunded. Refund it, then cancel the order with "Already refunded" ticked.`,
      );
      continue;
    }
    const lines = await db().select().from(orderLines).where(eq(orderLines.orderId, order.id));
    snapshots.push({ order, lines, payments: ps, storeOrders: sos });
    await db().delete(payments).where(eq(payments.orderId, order.id));
    await db().delete(storeOrders).where(eq(storeOrders.orderId, order.id));
    await db().delete(orderLines).where(eq(orderLines.orderId, order.id));
    await db().delete(orders).where(eq(orders.id, order.id));
    done.push(`#${order.number} deleted`);
  }
  return { done, problems, snapshots };
}

export const editOrderSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  shipping: addressSchema,
  poNumber: z.string().trim().max(50).transform((s) => s || null),
  notes: z.string().trim().max(1000).transform((s) => s || null),
  dueDate: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use a valid date")
    .transform((s) => s || null),
  syncWoo: z.boolean(),
});
export type EditOrderInput = z.infer<typeof editOrderSchema>;

/** Save an admin's edits to one order, and push address/PO/status to WooCommerce if asked. */
export async function editOrder(orderId: string, input: EditOrderInput, by: string): Promise<BulkResult> {
  const done: string[] = [];
  const problems: string[] = [];
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { done, problems: ["Order not found."] };

  const addressChanged = JSON.stringify(normalize(order.shippingAddress)) !== JSON.stringify(normalize(input.shipping));
  const poChanged = (order.poNumber ?? null) !== input.poNumber;

  await db()
    .update(orders)
    .set({ shippingAddress: input.shipping, poNumber: input.poNumber, notes: input.notes, dueDate: input.dueDate })
    .where(eq(orders.id, orderId));
  done.push("Details saved");

  if (input.syncWoo && (addressChanged || poChanged)) {
    await pushToWoo(order, { ...(addressChanged ? { shipping: input.shipping } : {}), ...(poChanged ? { poNumber: input.poNumber } : {}) }, by, problems);
    if (!problems.length) done.push("WooCommerce orders updated");
  }

  if (input.status !== order.status) {
    const r = await bulkSetStatus([orderId], input.status, { syncWoo: input.syncWoo, by });
    done.push(...r.done);
    problems.push(...r.problems);
  }
  return { done, problems };
}

function normalize(a: Address) {
  return [a.firstName, a.lastName, a.company ?? "", a.address1, a.address2 ?? "", a.city, a.state, a.postcode, a.phone ?? ""].map((v) => v.trim());
}
