import { NextResponse, type NextRequest } from "next/server";
import { and, count, countDistinct, desc, gte, inArray, isNotNull, lt, sql, sum } from "drizzle-orm";
import { accessRequests, db, orders, pageViews } from "@/lib/db";
import { getApiUser, isAdmin } from "@/lib/auth/session";

/** Orders that count toward revenue: paid, or waiting on a check/eCheck to clear. */
const COUNTED = ["processing", "awaiting_payment"] as const;

export type StatsResponse = {
  days: number;
  totals: { views: number; visitors: number; signedInUsers: number; orders: number; revenue: number; accessRequests: number };
  previous: { views: number; visitors: number; orders: number; revenue: number };
  daily: { date: string; views: number; visitors: number }[];
  topPages: { path: string; views: number }[];
  referrers: { host: string; views: number }[];
  devices: { device: string; views: number }[];
  countries: { country: string; views: number }[];
  audience: { dealers: number; admins: number; anonymous: number };
};

/**
 * Numbers for Studio → Statistics. Admins only: Studio runs on this same site, so the
 * portal session cookie comes along with the request.
 */
export async function GET(req: NextRequest) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "signin" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const days = [7, 30, 90].includes(Number(req.nextUrl.searchParams.get("days"))) ? Number(req.nextUrl.searchParams.get("days")) : 30;
  const now = Date.now();
  const since = new Date(now - days * 864e5);
  const prevSince = new Date(now - 2 * days * 864e5);
  const inRange = gte(pageViews.createdAt, since);
  const d = db();

  // A visitor hash only lives for one day, so "visitors" is the sum of daily uniques.
  const day = sql<string>`to_char(date_trunc('day', ${pageViews.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
  const dailyUniques = (from: Date, to?: Date) =>
    d
      .select({ day, visitors: countDistinct(pageViews.visitor) })
      .from(pageViews)
      .where(and(gte(pageViews.createdAt, from), to ? lt(pageViews.createdAt, to) : undefined))
      .groupBy(day);

  const orderTotals = (from: Date, to?: Date) =>
    d
      .select({ n: count(), revenue: sum(orders.total) })
      .from(orders)
      .where(and(gte(orders.createdAt, from), to ? lt(orders.createdAt, to) : undefined, inArray(orders.status, [...COUNTED])));

  const [
    [views],
    [prevViews],
    daily,
    dailyViews,
    prevDaily,
    [signedIn],
    topPages,
    referrers,
    devices,
    countries,
    audience,
    [orderNow],
    [orderPrev],
    [requests],
  ] = await Promise.all([
    d.select({ n: count() }).from(pageViews).where(inRange),
    d.select({ n: count() }).from(pageViews).where(and(gte(pageViews.createdAt, prevSince), lt(pageViews.createdAt, since))),
    dailyUniques(since),
    d.select({ day, views: count() }).from(pageViews).where(inRange).groupBy(day),
    dailyUniques(prevSince, since),
    d.select({ n: countDistinct(pageViews.userId) }).from(pageViews).where(and(inRange, isNotNull(pageViews.userId))),
    d.select({ path: pageViews.path, views: count() }).from(pageViews).where(inRange).groupBy(pageViews.path).orderBy(desc(count())).limit(10),
    d
      .select({ host: pageViews.referrerHost, views: count() })
      .from(pageViews)
      .where(and(inRange, isNotNull(pageViews.referrerHost)))
      .groupBy(pageViews.referrerHost)
      .orderBy(desc(count()))
      .limit(8),
    d.select({ device: pageViews.device, views: count() }).from(pageViews).where(inRange).groupBy(pageViews.device).orderBy(desc(count())),
    d
      .select({ country: pageViews.country, views: count() })
      .from(pageViews)
      .where(and(inRange, isNotNull(pageViews.country)))
      .groupBy(pageViews.country)
      .orderBy(desc(count()))
      .limit(8),
    d.select({ role: pageViews.role, views: count() }).from(pageViews).where(inRange).groupBy(pageViews.role),
    orderTotals(since),
    orderTotals(prevSince, since),
    d.select({ n: count() }).from(accessRequests).where(gte(accessRequests.createdAt, since)),
  ]);

  // Every day in the range, including days with no visits.
  const viewsByDay = new Map(dailyViews.map((r) => [r.day, r.views]));
  const visitorsByDay = new Map(daily.map((r) => [r.day, r.visitors]));
  const series: StatsResponse["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - i * 864e5).toISOString().slice(0, 10);
    series.push({ date, views: viewsByDay.get(date) ?? 0, visitors: visitorsByDay.get(date) ?? 0 });
  }
  const sumVisitors = (rows: { visitors: number }[]) => rows.reduce((s, r) => s + r.visitors, 0);
  const roleViews = (match: (role: string | null) => boolean) => audience.filter((a) => match(a.role)).reduce((s, a) => s + a.views, 0);

  const body: StatsResponse = {
    days,
    totals: {
      views: views?.n ?? 0,
      visitors: sumVisitors(daily),
      signedInUsers: signedIn?.n ?? 0,
      orders: orderNow?.n ?? 0,
      revenue: Number(orderNow?.revenue ?? 0),
      accessRequests: requests?.n ?? 0,
    },
    previous: { views: prevViews?.n ?? 0, visitors: sumVisitors(prevDaily), orders: orderPrev?.n ?? 0, revenue: Number(orderPrev?.revenue ?? 0) },
    daily: series,
    topPages,
    referrers: referrers.map((r) => ({ host: r.host ?? "", views: r.views })),
    devices,
    countries: countries.map((c) => ({ country: c.country ?? "", views: c.views })),
    audience: {
      dealers: roleViews((r) => r === "dealer"),
      admins: roleViews((r) => r === "brand_admin" || r === "super_admin"),
      anonymous: roleViews((r) => r === null),
    },
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
