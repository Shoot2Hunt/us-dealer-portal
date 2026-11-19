import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, orders } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { OrderStatus } from "@/components/status";
import { usd } from "@/components/cart";

export default async function OrdersPage() {
  const user = await requireUser();
  const rows = await db().select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.createdAt)).limit(200);
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Orders</h1>
      {!rows.length ? (
        <p className="text-muted">No orders yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">PO</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="px-3 py-2"><Link href={`/orders/${o.id}`} className="font-medium text-accent hover:underline">#{o.number}</Link></td>
                  <td className="px-3 py-2 text-muted">{o.createdAt.toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-muted">{o.poNumber ?? "—"}</td>
                  <td className="px-3 py-2"><OrderStatus status={o.status} /></td>
                  <td className="px-3 py-2 text-right">{usd(Number(o.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
