import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getOrderForUser } from "@/lib/orders";
import { OrderDetail } from "@/components/order-detail";
import { storeName } from "@/lib/woo/stores";
import { markCheckReceived, retryStoreOrder } from "../../actions";
import { usd } from "@/lib/money";

export default async function AdminOrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
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
  return (
    <div className="space-y-4">
      {(checks.length > 0 || failed.length > 0) && (
        <div className="card flex flex-wrap gap-3 bg-panel">
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
        </div>
      )}
      <OrderDetail detail={detail} admin />
    </div>
  );
}
