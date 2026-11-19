import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, orders, storeOrders, users } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { OrderStatus } from "@/components/status";
import { usd } from "@/components/cart";
import { storeName } from "@/lib/woo/stores";

export default async function AdminOrdersPage() {
  const admin = await requireAdmin();
  let rows = await db()
    .select({ order: orders, company: users.company, name: users.name })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .orderBy(desc(orders.createdAt))
    .limit(300);
  const sos = rows.length ? await db().select().from(storeOrders).where(inArray(storeOrders.orderId, rows.map((r) => r.order.id))) : [];
  if (admin.role === "brand_admin") {
    const mine = new Set(sos.filter((s) => s.store === admin.brandSlug).map((s) => s.orderId));
    rows = rows.filter((r) => mine.has(r.order.id));
  }
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Orders</h1>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-panel text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Dealer</th>
              <th className="px-3 py-2">Brands</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ order, company, name }) => {
              const mine = sos.filter((s) => s.orderId === order.id);
              return (
                <tr key={order.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <Link href={`/admin/orders/${order.id}`} className="font-medium text-accent hover:underline">#{order.number}</Link>
                    <span className="block text-xs text-muted">{order.createdAt.toLocaleDateString()}</span>
                  </td>
                  <td className="px-3 py-2">{company ?? name}</td>
                  <td className="px-3 py-2 text-muted">
                    {mine.map((s) => storeName(s.store)).join(", ")}
                    {mine.some((s) => s.error) && <span className="badge ml-1 bg-red-50 text-red-700">Needs attention</span>}
                  </td>
                  <td className="px-3 py-2"><OrderStatus status={order.status} /></td>
                  <td className="px-3 py-2 text-right">{usd(Number(order.total))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
