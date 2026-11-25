import Link from "next/link";
import { and, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db, orders, storeOrders, users } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { orderStatusLabel } from "@/components/status";
import { isStoreKey, storeName, STORES } from "@/lib/woo/stores";
import { ORDER_STATUSES } from "@/lib/admin-orders";
import { OrdersTable, type AdminOrderRow } from "./orders-table";

const PAGE_SIZE = 50;

/** Orders, newest first, with search, status/brand/date filters and (super admins) bulk actions. */
export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const [admin, sp] = await Promise.all([requireAdmin(), searchParams]);
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = one("q").slice(0, 100);
  const status = (ORDER_STATUSES as readonly string[]).includes(one("status")) ? one("status") : "";
  const isSuper = admin.role === "super_admin";
  // Brand admins only ever see orders that include their brand.
  const brand = isSuper ? (isStoreKey(one("brand")) ? one("brand") : "") : (admin.brandSlug ?? "__none__");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(one("from")) ? one("from") : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(one("to")) ? one("to") : "";
  const page = Math.max(1, Number(one("page")) || 1);

  // Everything except the status filter, so the status chips can show their counts.
  const base: SQL[] = [];
  if (brand) base.push(sql`exists (select 1 from ${storeOrders} where ${storeOrders.orderId} = ${orders.id} and ${storeOrders.store} = ${brand})`);
  if (from) base.push(gte(orders.createdAt, new Date(`${from}T00:00:00-07:00`)));
  if (to) base.push(lt(orders.createdAt, new Date(new Date(`${to}T00:00:00-07:00`).getTime() + 864e5)));
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const num = q.match(/^#?(\d{1,9})$/);
    base.push(
      or(
        ...(num ? [eq(orders.number, Number(num[1]))] : []),
        ilike(users.company, like),
        ilike(users.name, like),
        ilike(users.email, like),
        ilike(orders.poNumber, like),
        sql`${orders.shippingAddress}->>'company' ilike ${like}`,
        sql`exists (select 1 from ${storeOrders} where ${storeOrders.orderId} = ${orders.id} and ${storeOrders.wooOrderId}::text = ${q.replace(/^#/, "")})`,
      )!,
    );
  }
  const where = and(...base, ...(status ? [eq(orders.status, status as (typeof ORDER_STATUSES)[number])] : []));

  const [rows, totals, counts] = await Promise.all([
    db()
      .select({ order: orders, company: users.company, name: users.name, email: users.email })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().select({ n: count() }).from(orders).innerJoin(users, eq(users.id, orders.userId)).where(where),
    db().select({ status: orders.status, n: count() }).from(orders).innerJoin(users, eq(users.id, orders.userId)).where(and(...base)).groupBy(orders.status),
  ]);
  const total = totals[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sos = rows.length ? await db().select().from(storeOrders).where(inArray(storeOrders.orderId, rows.map((r) => r.order.id))) : [];
  const countOf = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const allCount = counts.reduce((n, c) => n + c.n, 0);

  const data: AdminOrderRow[] = rows.map(({ order, company, name, email }) => {
    const mine = sos.filter((s) => s.orderId === order.id);
    return {
      id: order.id,
      number: order.number,
      date: order.createdAt.toLocaleDateString("en-US", { timeZone: "America/Denver" }),
      dealer: company ?? name,
      email,
      poNumber: order.poNumber,
      brands: mine.map((s) => storeName(s.store)),
      wooIds: mine.filter((s) => s.wooOrderId).map((s) => s.wooOrderId!),
      needsAttention: mine.some((s) => s.error),
      status: order.status,
      total: Number(order.total),
    };
  });

  /** This page's link with some filters changed (page resets unless given). */
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    const cur = { q, status, brand: isSuper ? brand : "", from, to, ...patch };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/orders${s ? `?${s}` : ""}`;
  };
  const filtered = Boolean(q || status || (isSuper && brand) || from || to);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-muted">
            {total.toLocaleString()} order{total === 1 ? "" : "s"}
            {filtered ? " match" : ""}
            {isSuper ? ". Tick orders to change their status or delete them." : "."}
          </p>
        </div>
      </div>

      {/* Search + filters: a plain GET form, so every view has its own link. */}
      <form action="/admin/orders" className="card flex flex-wrap items-end gap-3 p-4">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="min-w-[14rem] flex-1">
          <label className="label" htmlFor="q">Search</label>
          <div className="relative">
            <span className="icon-[lucide--search] pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input id="q" name="q" defaultValue={q} className="input pl-9" placeholder="Order #, dealer, email, PO, Woo order #" />
          </div>
        </div>
        {isSuper && (
          <div>
            <label className="label" htmlFor="brand">Brand</label>
            <select id="brand" name="brand" defaultValue={brand} className="input">
              <option value="">All brands</option>
              {STORES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to} className="input" />
        </div>
        <button className="btn">Search</button>
        {filtered && <Link href="/admin/orders" className="btn-ghost">Clear</Link>}
      </form>

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filter by status">
        <Link href={href({ status: "" })} className={`rounded-full border px-3 py-1 ${!status ? "border-ink bg-ink text-white" : "border-line hover:bg-panel"}`}>
          All <span className="opacity-70">{allCount}</span>
        </Link>
        {ORDER_STATUSES.map((s) => (
          <Link key={s} href={href({ status: s })} className={`rounded-full border px-3 py-1 ${status === s ? "border-ink bg-ink text-white" : "border-line hover:bg-panel"}`}>
            {orderStatusLabel(s)} <span className="opacity-70">{countOf(s)}</span>
          </Link>
        ))}
      </nav>

      <OrdersTable rows={data} canManage={isSuper} />

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
