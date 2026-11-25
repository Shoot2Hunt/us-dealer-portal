import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, inArray } from "drizzle-orm";
import { db, inventory, type orderLines, type storeOrders } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { getOrderForUser } from "@/lib/orders";
import { usd } from "@/lib/money";
import { storeName } from "@/lib/woo/stores";
import { EditOrderForm } from "./edit-form";

type OrderLine = typeof orderLines.$inferSelect;
type StoreOrder = typeof storeOrders.$inferSelect;

export default async function EditOrderPage({ params }: PageProps<"/admin/orders/[id]/edit">) {
  const { id } = await params;
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") redirect(`/admin/orders/${id}`);
  const detail = await getOrderForUser(admin, id).catch(() => null);
  if (!detail) notFound();
  const { order, lines } = detail;

  // A photo per line from the catalog: the variation's own, else the parent product's.
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const stores = [...new Set(lines.map((l) => l.store))];
  const pics = productIds.length
    ? await db()
        .select({ store: inventory.store, productId: inventory.productId, variationId: inventory.variationId, imageUrl: inventory.imageUrl })
        .from(inventory)
        .where(and(inArray(inventory.productId, productIds), inArray(inventory.store, stores)))
    : [];
  const images: Record<number, string | null> = {};
  for (const l of lines) {
    const same = pics.filter((p) => p.store === l.store && p.productId === l.productId && p.imageUrl);
    images[l.id] = (same.find((p) => p.variationId === l.variationId) ?? same.find((p) => p.variationId === 0) ?? same[0])?.imageUrl ?? null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/admin/orders/${order.id}`} className="text-sm text-accent hover:underline">← Order #{order.number}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit order #{order.number}</h1>
        <p className="text-sm text-muted">
          Change the status, ship-to address, PO number, notes or due date. Items and prices can&apos;t be changed here, since
          they were already charged; cancel the order and place a new one instead.
        </p>
      </div>
      <ItemsOrdered
        lines={lines}
        storeOrders={detail.storeOrders}
        images={images}
        discountTotal={Number(order.discountTotal)}
        discountCode={order.discountCode}
        total={Number(order.total)}
      />
      <EditOrderForm
        order={{
          id: order.id,
          number: order.number,
          status: order.status,
          shipping: order.shippingAddress,
          poNumber: order.poNumber ?? "",
          notes: order.notes ?? "",
          dueDate: order.dueDate ?? "",
          hasWoo: detail.storeOrders.some((s) => s.wooOrderId),
        }}
      />
    </div>
  );
}

/** Read-only list of what was ordered, grouped by brand. Items can't be edited (already charged). */
function ItemsOrdered({
  lines,
  storeOrders,
  images,
  discountTotal,
  discountCode,
  total,
}: {
  lines: OrderLine[];
  storeOrders: StoreOrder[];
  images: Record<number, string | null>;
  discountTotal: number;
  discountCode: string | null;
  total: number;
}) {
  const byStore = Map.groupBy(lines, (l) => l.store);
  const units = lines.reduce((n, l) => n + l.quantity, 0);
  const subtotal = lines.reduce((n, l) => n + Number(l.unitPrice) * l.quantity, 0);
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Items ordered</h2>
        <span className="text-sm text-muted">
          {lines.length} product{lines.length === 1 ? "" : "s"} · {units} unit{units === 1 ? "" : "s"}
        </span>
      </div>
      {[...byStore].map(([store, items]) => {
        const so = storeOrders.find((s) => s.store === store);
        return (
          <div key={store} className="overflow-x-auto rounded-lg border border-line">
            <div className="flex items-center justify-between bg-panel px-3 py-2 text-sm">
              <span className="font-medium">{storeName(store)}</span>
              {so?.wooOrderId && (
                <span className="text-xs text-muted">
                  Woo #{so.wooOrderId}
                  {so.wooStatus ? ` · ${so.wooStatus}` : ""}
                </span>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit price</th>
                  <th className="px-3 py-2 text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className="border-t border-line first:border-t-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-panel ring-1 ring-line">
                          {images[l.id] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={images[l.id]!} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <span className="icon-[lucide--package] h-5 w-5 text-muted" aria-hidden="true" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <a
                            href={`/inventory/${l.store}/${l.productId}${l.variationId ? `?v=${l.variationId}` : ""}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:text-accent hover:underline"
                          >
                            {l.name}
                          </a>
                          {l.sku && <span className="block text-xs text-muted">SKU {l.sku}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{usd(Number(l.unitPrice))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {usd(Number(l.unitPrice) * l.quantity)}
                      {Number(l.discount) > 0 && <span className="block text-xs text-green-700">−{usd(Number(l.discount))} code</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Subtotal</dt>
          <dd className="tabular-nums">{usd(subtotal)}</dd>
        </div>
        {discountTotal > 0 && (
          <div className="flex justify-between text-green-700">
            <dt>Discount{discountCode ? ` (${discountCode})` : ""}</dt>
            <dd className="tabular-nums">−{usd(discountTotal)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-line pt-1 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{usd(total)}</dd>
        </div>
      </dl>
    </section>
  );
}
