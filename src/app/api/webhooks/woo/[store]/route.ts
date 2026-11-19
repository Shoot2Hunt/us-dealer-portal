import { NextResponse, after, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, storeOrders } from "@/lib/db";
import { getStore, isStoreKey, type StoreKey } from "@/lib/woo/stores";
import { verifyWooSignature } from "@/lib/woo/webhook";
import { markWebhook, refreshProduct, removeProduct } from "@/lib/woo/sync";
import { trackingFromOrder } from "@/lib/woo/orders";
import type { WooOrder } from "@/lib/woo/client";

export const maxDuration = 60;

/**
 * One endpoint per store: /api/webhooks/woo/<store-key>
 * Receives WooCommerce webhooks (product.*, order.*) and pings from the dealer-portal mu-plugin.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/webhooks/woo/[store]">) {
  const { store: storeParam } = await ctx.params;
  if (!isStoreKey(storeParam)) return NextResponse.json({ error: "unknown store" }, { status: 404 });
  const storeKey: StoreKey = storeParam;
  const store = getStore(storeKey);

  const raw = await req.text();
  const topic = req.headers.get("x-wc-webhook-topic");
  const signature = req.headers.get("x-wc-webhook-signature") ?? req.headers.get("x-dp-signature");

  // WooCommerce sends an unsigned "webhook_id=…" ping when a webhook is saved.
  if (!topic && !req.headers.get("x-dp-signature") && raw.startsWith("webhook_id=")) {
    return NextResponse.json({ ok: true });
  }
  if (!verifyWooSignature(raw, signature, store.webhookSecret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  // Answer fast so WooCommerce doesn't time out; do the work after responding.
  after(async () => {
    try {
      await markWebhook(storeKey);
      await handle(storeKey, topic, body);
    } catch (err) {
      console.error(`[woo webhook ${storeKey}]`, err);
    }
  });
  return NextResponse.json({ ok: true });
}

async function handle(storeKey: StoreKey, topic: string | null, body: Record<string, unknown>) {
  // mu-plugin stock ping: { id, parent }
  if (!topic) {
    const id = Number(body.parent) || Number(body.id);
    if (id) await refreshProduct(storeKey, id);
    return;
  }

  const [resource, event] = topic.split(".");
  if (resource === "product") {
    const id = Number(body.id);
    if (!id) return;
    if (event === "deleted") await removeProduct(storeKey, id);
    else await refreshProduct(storeKey, Number(body.parent_id) || id);
    return;
  }

  if (resource === "order") {
    const order = body as unknown as WooOrder;
    // Stock changed: refresh every product in the order.
    const ids = new Set(order.line_items?.map((l) => l.product_id).filter(Boolean));
    for (const id of ids) await refreshProduct(storeKey, id);

    // If this is one of our portal orders, mirror its status and tracking.
    const isPortal = order.meta_data?.some((m) => m.key === "_dealer_portal_order_id");
    if (isPortal) {
      await db()
        .update(storeOrders)
        .set({ wooStatus: order.status, tracking: trackingFromOrder(order), updatedAt: new Date() })
        .where(and(eq(storeOrders.store, storeKey), eq(storeOrders.wooOrderId, order.id)));
    }
  }
}
