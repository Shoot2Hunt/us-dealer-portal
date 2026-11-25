import Link from "next/link";
import { and, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { db, orderLines, orders } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { OrderStatus, orderStatusLabel } from "@/components/status";
import { usd } from "@/lib/money";

const STATUSES = ["processing", "awaiting_payment", "payment_problem", "failed", "cancelled"] as const;
const PAGE_SIZE = 50;

/** The dealer's own orders, with search, status chips and a date range. */
export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = one("q").slice(0, 100);
  const status = (STATUSES as readonly string[]).includes(one("status")) ? (one("status") as (typeof STATUSES)[number]) : null;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(one("from")) ? one("from") : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(one("to")) ? one("to") : "";
  const page = Math.max(1, Number(one("page")) || 1);

  // Everything but the status, so each status chip can show its count.
  const base: SQL[] = [eq(orders.userId, user.id)];
  if (from) base.push(gte(orders.createdAt, new Date(`${from}T00:00:00-07:00`)));
  if (to) base.push(lt(orders.createdAt, new Date(new Date(`${to}T00:00:00-07:00`).getTime() + 864e5)));
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const num = q.match(/^#?(\d{1,9})$/);
    base.push(
      or(
        ...(num ? [eq(orders.number, Number(num[1]))] : []),
        ilike(orders.poNumber, like),
        // Anything they ordered: product name or SKU.
        sql`exists (select 1 from ${orderLines} where ${orderLines.orderId} = ${orders.id} and (${orderLines.name} ilike ${like} or ${orderLines.sku} ilike ${like}))`,
      )!,
    );
  }
  const where = and(...base, ...(status ? [eq(orders.status, status)] : []));

  const [rows, totals, counts, [{ n: everything }]] = await Promise.all([
    db().select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db().select({ n: count() }).from(orders).where(where),
    db().select({ status: orders.status, n: count() }).from(orders).where(and(...base)).groupBy(orders.status),
    db().select({ n: count() }).from(orders).where(eq(orders.userId, user.id)),
  ]);
  const total = totals[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const countOf = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const allCount = counts.reduce((n, c) => n + c.n, 0);
  const filtered = Boolean(q || status || from || to);

  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status: status ?? "", from, to, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/orders${s ? `?${s}` : ""}`;
  };

  if (!everything) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-muted">No orders yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-sm text-muted">
          {total.toLocaleString()} order{total === 1 ? "" : "s"}
          {filtered ? " match" : ""}
        </p>
      </div>

      {/* A plain GET form, so a filtered view can be bookmarked. */}
      <form action="/orders" className="card flex flex-wrap items-end gap-3 p-4">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="min-w-[14rem] flex-1">
          <label className="label" htmlFor="q">Search</label>
          <div className="relative">
            <span className="icon-[lucide--search] pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input id="q" name="q" defaultValue={q} className="input pl-9" placeholder="Order #, PO, product or SKU" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to} className="input" />
        </div>
        <button className="btn">Search</button>
        {filtered && <Link href="/orders" className="btn-ghost">Clear</Link>}
      </form>

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filter by status">
        <Link href={href({ status: "" })} className={`rounded-full border px-3 py-1 ${!status ? "border-ink bg-ink text-white" : "border-line hover:bg-panel"}`}>
          All <span className="opacity-70">{allCount}</span>
        </Link>
        {STATUSES.filter((s) => countOf(s) > 0 || status === s).map((s) => (
          <Link key={s} href={href({ status: s })} className={`rounded-full border px-3 py-1 ${status === s ? "border-ink bg-ink text-white" : "border-line hover:bg-panel"}`}>
            {orderStatusLabel(s)} <span className="opacity-70">{countOf(s)}</span>
          </Link>
        ))}
      </nav>

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
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted">
                  No orders match. <Link href="/orders" className="text-accent hover:underline">Show all orders</Link>
                </td>
              </tr>
            )}
            {rows.map((o) => (
              <tr key={o.id} className="border-t border-line">
                <td className="px-3 py-2"><Link href={`/orders/${o.id}`} className="font-medium text-accent hover:underline">#{o.number}</Link></td>
                <td className="px-3 py-2 text-muted">{o.createdAt.toLocaleDateString("en-US", { timeZone: "America/Denver" })}</td>
                <td className="px-3 py-2 text-muted">{o.poNumber ?? "—"}</td>
                <td className="px-3 py-2"><OrderStatus status={o.status} /></td>
                <td className="px-3 py-2 text-right">{usd(Number(o.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className="btn-ghost" href={href({ page: String(page - 1) })}>← Newer</Link>}
            {page < pages && <Link className="btn-ghost" href={href({ page: String(page + 1) })}>Older →</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
