import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getOrderForUser } from "@/lib/orders";
import { OrderDetail } from "@/components/order-detail";
import { storeName } from "@/lib/woo/stores";
import { cancelOrder, markCheckReceived, retryStoreOrder } from "../../actions";
import { usd } from "@/lib/money";

const LIVE = new Set(["authorized", "captured", "pending_settlement"]);

export default async function AdminOrderPage({ params, searchParams }: PageProps<"/admin/orders/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const admin = await requireAdmin();
  const detail = await getOrderForUser(admin, id).catch(() => null);
  if (!detail) notFound();
  // Only show buttons the admin may use: checks are super-admin only; retries for their own brand.
  const isSuper = admin.role === "super_admin";
  // Checks being waited on, and invoice amounts a dealer may pay by mailing a check.
  const checks = isSuper
    ? detail.payments.filter((p) => (p.method === "check" && p.status === "awaiting_check") || (p.method === "terms" && p.status === "invoiced"))
    : [];
  const failed = detail.storeOrders.filter((s) => !s.wooOrderId && (isSuper || s.store === admin.brandSlug));
  // Cancel: for open orders, or a cancelled one that still has card/ACH money to give back.
  const livePayments = detail.payments.filter((p) => LIVE.has(p.status));
  const cancelled = detail.order.status === "cancelled";
  const canCancel = isSuper && (!cancelled || livePayments.length > 0);

  const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
  const done = list(sp.done);
  const problems = list(sp.problem);

  return (
    <div className="space-y-4">
      {(done.length > 0 || problems.length > 0) && (
        <div role="status" className={`card space-y-2 text-sm ${problems.length ? "border-amber-300 bg-amber-50" : "border-green-200 bg-green-50"}`}>
          {done.map((d) => (
            <p key={d} className="flex items-start gap-2 text-green-900">
              <span className="icon-[lucide--check] mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {d}
            </p>
          ))}
          {problems.map((p) => (
            <p key={p} className="flex items-start gap-2 text-amber-900">
              <span className="icon-[lucide--triangle-alert] mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {p}
            </p>
          ))}
        </div>
      )}

      {isSuper && (
        <div className="flex justify-end">
          <Link href={`/admin/orders/${detail.order.id}/edit`} className="btn-ghost inline-flex items-center gap-1.5">
            <span className="icon-[lucide--pencil] h-4 w-4" aria-hidden="true" /> Edit order
          </Link>
        </div>
      )}
      {(checks.length > 0 || failed.length > 0 || canCancel) && (
        <div className="card flex flex-wrap items-start gap-3 bg-panel">
          {checks.map((p) => (
            <form key={p.id} action={markCheckReceived}>
              <input type="hidden" name="paymentId" value={p.id} />
              <button className="btn">{p.method === "terms" ? `Invoice paid: mark ${usd(Number(p.amount))} check received` : `Mark ${usd(Number(p.amount))} check received`}</button>
            </form>
          ))}
          {failed.map((s) => (
            <form key={s.id} action={retryStoreOrder}>
              <input type="hidden" name="storeOrderId" value={s.id} />
              <button className="btn-accent">Retry sending to {storeName(s.store)}</button>
            </form>
          ))}
          {canCancel && (
            <details className="ml-auto rounded-md border border-red-200 bg-white text-sm">
              <summary className="cursor-pointer list-none px-3 py-2 font-medium text-red-700 hover:bg-red-50">
                <span className="icon-[lucide--circle-x] mr-1.5 inline-block h-4 w-4 align-[-3px]" aria-hidden="true" />
                {cancelled ? "Void remaining payments" : "Cancel order"}
              </summary>
              <form action={cancelOrder} className="space-y-3 border-t border-red-100 p-3">
                <input type="hidden" name="orderId" value={detail.order.id} />
                <ul className="list-disc space-y-1 pl-5 text-muted">
                  {livePayments.length > 0 && (
                    <li>
                      Voids {livePayments.map((p) => `${p.method === "ach" ? "ACH" : "card"} ${usd(Number(p.amount))}`).join(", ")} in Authorize.net. If you already voided
                      or refunded it there, that&apos;s picked up.
                    </li>
                  )}
                  {!cancelled && <li>Cancels each brand&apos;s WooCommerce order (stock goes back).</li>}
                  {!cancelled && <li>Marks the order cancelled; nothing stays owed.</li>}
                </ul>
                {livePayments.length > 0 && (
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="alreadyRefunded" className="mt-0.5" />
                    <span>
                      Already refunded in Authorize.net
                      <span className="block text-xs text-muted">Only for a settled charge you refunded there by hand (settled charges can&apos;t be voided).</span>
                    </span>
                  </label>
                )}
                <button className="btn w-full justify-center bg-red-600 text-white hover:bg-red-700">{cancelled ? "Void payments" : "Yes, cancel this order"}</button>
              </form>
            </details>
          )}
        </div>
      )}
      <OrderDetail detail={detail} admin />
    </div>
  );
}
