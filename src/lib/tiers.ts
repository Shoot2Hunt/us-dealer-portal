import "server-only";
import { cache } from "react";
import { and, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { db, orders } from "@/lib/db";

/**
 * Dealer volume tiers. A dealer's tier comes from what they've spent on PAID
 * portal orders over the last 12 months (rolling), and gives a % off retail.
 * At checkout the dealer pays whichever is lower: the tier price or their
 * normal dealer price (Sanity fixed price or brand discount). Never stacked.
 *
 * To change the levels, edit this list (keep it sorted by minSpend).
 */
export const TIERS = [
  { level: 1, name: "Tier 1", minSpend: 20_000, percentOff: 20 },
  { level: 2, name: "Tier 2", minSpend: 35_000, percentOff: 25 },
  { level: 3, name: "Tier 3", minSpend: 50_000, percentOff: 30 },
] as const;

export type Tier = (typeof TIERS)[number];

/** Days of order history that count toward a tier. */
export const TIER_WINDOW_DAYS = 365;

export type TierStatus = {
  /** Paid spend in the window, in dollars. */
  spend: number;
  tier: Tier | null;
  next: Tier | null;
  /** Dollars still needed to reach `next`. */
  toNext: number;
};

/**
 * "processing" is the portal's fully-paid status (card captured, eCheck settled
 * or check received). Unpaid, failed, cancelled and payment-problem orders don't count.
 */
const paidInWindow = () =>
  and(eq(orders.status, "processing"), gte(orders.createdAt, new Date(Date.now() - TIER_WINDOW_DAYS * 864e5)));

export function tierForSpend(spend: number): TierStatus {
  const tier = [...TIERS].reverse().find((t) => spend >= t.minSpend) ?? null;
  const next = TIERS.find((t) => spend < t.minSpend) ?? null;
  // Round up to whole dollars so $19,999.99 shows "$1 more", not "$0 more".
  return { spend, tier, next, toNext: next ? Math.max(1, Math.ceil(next.minSpend - spend)) : 0 };
}

/** One dealer's tier. Cached per request, since pricing asks for it more than once. */
export const getTierStatus = cache(async (userId: string): Promise<TierStatus> => {
  const [row] = await db()
    .select({ total: sum(orders.total) })
    .from(orders)
    .where(and(eq(orders.userId, userId), paidInWindow()));
  return tierForSpend(Number(row?.total ?? 0));
});

/** Tiers for many dealers at once (admin Dealers page). */
export async function getTierStatuses(userIds: string[]): Promise<Map<string, TierStatus>> {
  const out = new Map(userIds.map((id) => [id, tierForSpend(0)]));
  if (!userIds.length) return out;
  const rows = await db()
    .select({ userId: orders.userId, total: sql<string>`sum(${orders.total})` })
    .from(orders)
    .where(and(inArray(orders.userId, userIds), paidInWindow()))
    .groupBy(orders.userId);
  for (const r of rows) out.set(r.userId, tierForSpend(Number(r.total ?? 0)));
  return out;
}
