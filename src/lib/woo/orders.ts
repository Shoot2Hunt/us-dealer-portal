import "server-only";
import { and, eq } from "drizzle-orm";
import { db, storeCustomers, type Address, type User } from "@/lib/db";
import { woo, type WooOrder } from "./client";
import { billingAddressFor } from "@/lib/billing";
import { getStore, type StoreKey } from "./stores";

function wooAddress(a: Address, email?: string) {
  return {
    first_name: a.firstName,
    last_name: a.lastName,
    company: a.company ?? "",
    address_1: a.address1,
    address_2: a.address2 ?? "",
    city: a.city,
    state: a.state,
    postcode: a.postcode,
    country: "US",
    phone: a.phone ?? "",
    ...(email ? { email } : {}),
  };
}

/** Find or create the dealer's customer account in a store and remember the link. */
export async function ensureWooCustomer(storeKey: StoreKey, user: User, address: Address): Promise<number> {
  const [link] = await db()
    .select()
    .from(storeCustomers)
    .where(and(eq(storeCustomers.userId, user.id), eq(storeCustomers.store, storeKey)));
  if (link) return link.wooCustomerId;

  const store = getStore(storeKey);
  const existing = await woo<{ id: number }[]>(store, "/customers", { query: { email: user.email, role: "all" } });
  let id = existing.data[0]?.id;
  if (!id) {
    const created = await woo<{ id: number }>(store, "/customers", {
      method: "POST",
      body: {
        email: user.email,
        first_name: address.firstName,
        last_name: address.lastName,
        username: user.email,
        billing: wooAddress(billingAddressFor(user) ?? address, user.billingEmail ?? user.email),
        shipping: wooAddress(address),
        meta_data: [{ key: "_dealer_portal_user_id", value: user.id }],
      },
    });
    id = created.data.id;
  }
  await db().insert(storeCustomers).values({ userId: user.id, store: storeKey, wooCustomerId: id }).onConflictDoNothing();
  return id;
}

export type NewStoreOrder = {
  storeKey: StoreKey;
  user: User;
  address: Address;
  portalOrderId: string;
  portalOrderNumber: number;
  poNumber?: string | null;
  paid: boolean;
  /** Ship now although not paid yet (dealer on net terms). Goes to Processing, not marked paid. */
  release?: boolean;
  paymentSummary: string;
  /** Portal discount code used on the order, if any (noted on the Woo order). */
  discountCode?: string;
  /** `discount` is this line's share of the discount code, in dollars. */
  lines: { productId: number; variationId: number; quantity: number; unitPrice: string; discount?: string }[];
};

/**
 * Create the brand's WooCommerce order. Dealer prices are sent as explicit line totals.
 * Paid orders go to Processing; anything waiting on a check or eCheck goes On hold.
 */
export async function createWooOrder(o: NewStoreOrder): Promise<WooOrder> {
  const store = getStore(o.storeKey);
  const customerId = await ensureWooCustomer(o.storeKey, o.user, o.address);
  const { data } = await woo<WooOrder>(store, "/orders", {
    method: "POST",
    body: {
      status: o.paid || o.release ? "processing" : "on-hold",
      set_paid: o.paid,
      customer_id: customerId,
      payment_method: "dealer_portal",
      payment_method_title: "Dealer Portal",
      // Billing details from the dealer's Billing page; shipping is this order's address.
      billing: wooAddress(billingAddressFor(o.user) ?? o.address, o.user.billingEmail ?? o.user.email),
      shipping: wooAddress(o.address),
      customer_note: o.poNumber ? `PO: ${o.poNumber}` : "",
      line_items: o.lines.map((l) => {
        // subtotal = before the discount code, total = after. WooCommerce shows the gap as a discount.
        const subtotalCents = Math.round(Number(l.unitPrice) * 100) * l.quantity;
        const totalCents = subtotalCents - Math.round(Number(l.discount ?? 0) * 100);
        return {
          product_id: l.productId,
          ...(l.variationId ? { variation_id: l.variationId } : {}),
          quantity: l.quantity,
          subtotal: (subtotalCents / 100).toFixed(2),
          total: (totalCents / 100).toFixed(2),
        };
      }),
      meta_data: [
        { key: "_dealer_portal_order_id", value: o.portalOrderId },
        { key: "_dealer_portal_order_number", value: String(o.portalOrderNumber) },
        { key: "_dealer_portal_payment", value: o.paymentSummary },
        ...(o.discountCode ? [{ key: "_dealer_portal_discount_code", value: o.discountCode }] : []),
      ],
    },
  });
  await addOrderNote(
    o.storeKey,
    data.id,
    `Dealer portal order #${o.portalOrderNumber}. Payment: ${o.paymentSummary}${o.discountCode ? `. Discount code: ${o.discountCode}` : ""}`,
  );
  return data;
}

export async function setWooOrderStatus(storeKey: StoreKey, wooOrderId: number, status: "processing" | "on-hold" | "cancelled", note?: string) {
  const store = getStore(storeKey);
  await woo(store, `/orders/${wooOrderId}`, {
    method: "PUT",
    body: { status, ...(status === "processing" ? { set_paid: true } : {}) },
  });
  if (note) await addOrderNote(storeKey, wooOrderId, note);
}

export async function addOrderNote(storeKey: StoreKey, wooOrderId: number, note: string) {
  await woo(getStore(storeKey), `/orders/${wooOrderId}/notes`, { method: "POST", body: { note, customer_note: false } });
}

/** Read tracking numbers saved by the common "Shipment Tracking" plugins, if any. */
export function trackingFromOrder(order: WooOrder): string | null {
  const meta = order.meta_data.find((m) => m.key === "_wc_shipment_tracking_items");
  if (!Array.isArray(meta?.value)) return null;
  const items = meta.value as { tracking_provider?: string; custom_tracking_provider?: string; tracking_number?: string }[];
  const text = items
    .filter((i) => i.tracking_number)
    .map((i) => `${i.tracking_provider || i.custom_tracking_provider || ""} ${i.tracking_number}`.trim())
    .join(", ");
  return text || null;
}
