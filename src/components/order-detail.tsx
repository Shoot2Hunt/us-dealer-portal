import type { getOrderForUser } from "@/lib/orders";
import { storeName } from "@/lib/woo/stores";
import { OrderStatus, methodLabel, paymentLabel } from "./status";
import { usd } from "./cart";
import Link from "next/link";
import { balanceOf, formatDue, todayIso } from "@/lib/invoices";

type Detail = NonNullable<Awaited<ReturnType<typeof getOrderForUser>>>;

const WOO_STATUS: Record<string, string> = {
  "on-hold": "On hold",
  processing: "Processing",
  completed: "Shipped",
  cancelled: "Cancelled",
  refunded: "Refunded",
  pending: "Pending",
};

/** Shared by the dealer's order page and the admin order page. */
export function OrderDetail({ detail, admin = false }: { detail: Detail; admin?: boolean }) {
  const { order, lines, storeOrders, payments } = detail;
  const byStore = Map.groupBy(lines, (l) => l.store);
  const a = order.shippingAddress;
  const owed = ["failed", "cancelled"].includes(order.status) ? null : balanceOf(order, payments);
  const pastDue = Boolean(owed && owed.balance > 0 && order.dueDate && order.dueDate < todayIso());
  // "Paid another way" rows are bookkeeping for admins; dealers see what they paid and owe.
  const shown = admin ? payments : payments.filter((p) => p.status !== "superseded");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Order #{order.number}</h1>
        <OrderStatus status={order.status} />
        <span className="text-sm text-muted">{order.createdAt.toLocaleString()}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {[...byStore].map(([store, items]) => {
            const so = storeOrders.find((s) => s.store === store);
            return (
              <section key={store} className="card">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">{storeName(store)}</h2>
                  <span className="text-sm text-muted">
                    {so?.wooStatus ? WOO_STATUS[so.wooStatus] ?? so.wooStatus : "Sending to brand…"}
                    {admin && so?.wooOrderId && ` · Woo #${so.wooOrderId}`}
                  </span>
                </div>
                {so?.tracking && <p className="mb-3 text-sm">Tracking: <strong>{so.tracking}</strong></p>}
                {admin && so?.error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-800">Not sent to WooCommerce: {so.error}</p>}
                <ul className="divide-y divide-line text-sm">
                  {items.map((l) => (
                    <li key={l.id} className="flex justify-between py-2">
                      <span>{l.quantity} × {l.name} <span className="text-xs text-muted">{l.sku}</span></span>
                      <span className="text-right">
                        {usd(Number(l.unitPrice) * l.quantity)}
                        {Number(l.discount) > 0 && <span className="block text-xs text-green-700">−{usd(Number(l.discount))} code</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <aside className="space-y-4">
          <div className="card space-y-2 text-sm">
            <h2 className="font-semibold">Payment</h2>
            {shown.map((p) => (
              <div key={p.id} className="flex justify-between gap-2">
                <span>{methodLabel(p.method)}{p.last4 && ` …${p.last4}`}<span className="block text-xs text-muted">{paymentLabel(p.status)}{admin && p.transId && ` · ${p.transId}`}</span></span>
                <span>{usd(Number(p.amount))}</span>
              </div>
            ))}
            {Number(order.discountTotal) > 0 && (
              <div className="flex justify-between gap-2 border-t border-line pt-2 text-green-700">
                <span className="flex items-center gap-1">
                  <span className="icon-[lucide--ticket-percent] h-4 w-4" aria-hidden="true" /> Discount {order.discountCode && <strong>{order.discountCode}</strong>}
                </span>
                <span>−{usd(Number(order.discountTotal))}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-line pt-2 font-semibold">
              <span>Total</span>
              <span>{usd(Number(order.total))}</span>
            </div>
            {owed && owed.balance > 0 && (
              <div className={`space-y-2 rounded-md px-3 py-2 ${pastDue ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
                <div className="flex justify-between font-semibold">
                  <span>Balance due</span>
                  <span>{usd(owed.balance / 100)}</span>
                </div>
                <p className="text-xs">{order.dueDate ? `${pastDue ? "Was due" : "Due"} ${formatDue(order.dueDate)}` : "Due on receipt"}</p>
                {!admin && (
                  <Link href={`/billing?pay=${order.id}`} className="btn-accent w-full justify-center text-sm">
                    <span className="icon-[lucide--credit-card] h-4 w-4" aria-hidden="true" /> Pay this invoice
                  </Link>
                )}
              </div>
            )}
            {owed && owed.clearing > 0 && <p className="text-xs text-muted">{usd(owed.clearing / 100)} is still clearing.</p>}
          </div>
          <div className="card text-sm">
            <h2 className="mb-1 font-semibold">Ship to</h2>
            <p>{a.firstName} {a.lastName}</p>
            {a.company && <p>{a.company}</p>}
            <p>{a.address1}{a.address2 && `, ${a.address2}`}</p>
            <p>{a.city}, {a.state} {a.postcode}</p>
            {order.poNumber && <p className="mt-2 text-muted">PO {order.poNumber}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
