/**
 * Dealer pricing rules, in one place so the inventory, product pages, cart and checkout
 * always agree. Pure functions: no database or Sanity access.
 *
 *   regular price  = retail − the brand's default dealer discount
 *                    (or the admin's fixed dealer price, when that is higher)
 *   admin price    = Product settings → Dealer price, while its sale dates (if any) are current
 *   promotion      = best active promotion % off, applied to the admin price or regular price
 *   tier price     = retail − the dealer's volume tier %
 *
 * The dealer pays the lowest of those. When that is below the regular price, the regular
 * price is shown crossed out with the reason (Sale / the promotion / the tier).
 */

export type Scope = { brands?: string[]; categories?: string[]; skus?: string[] };

export type PricedPromotion = Scope & { id: string; title: string; percentOff: number; startsAt?: string; endsAt?: string };

export type PriceReason = { kind: "sale" | "promotion" | "tier"; label: string };

export type PriceResult = {
  /** What the dealer pays, or null when there's no price at all. */
  price: number | null;
  /** The crossed-out "was" price, only when `price` is lower than the regular dealer price. */
  compareAt: number | null;
  reason: PriceReason | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const pctOff = (n: number, pct: number) => round2(n * (100 - pct) / 100);

/** Is `now` inside an optional start/end window? */
export function isCurrent(startsAt: string | undefined | null, endsAt: string | undefined | null, now = Date.now()): boolean {
  if (startsAt && Date.parse(startsAt) > now) return false;
  if (endsAt && Date.parse(endsAt) <= now) return false;
  return true;
}

/** Does a brand/category/SKU scope cover this item? Empty lists everywhere = everything. */
export function inScope(scope: Scope, item: { store: string; categories: string[]; sku: string | null }): boolean {
  const brands = scope.brands ?? [];
  const cats = scope.categories ?? [];
  const skus = (scope.skus ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!brands.length && !cats.length && !skus.length) return true;
  if (brands.length && !brands.includes(item.store)) return false;
  if (cats.length && !item.categories.some((c) => cats.includes(c))) return false;
  if (skus.length && !(item.sku && skus.includes(item.sku.trim().toLowerCase()))) return false;
  return true;
}

export function computePrice(input: {
  retail: number | null;
  brandDiscountPercent: number;
  /** Admin's fixed dealer price, already checked against its sale dates. */
  adminPrice: number | null;
  /** The single best promotion covering this item, if any. */
  promotion: { title: string; percentOff: number } | null;
  tier: { name: string; percentOff: number } | null;
}): PriceResult {
  const { retail, brandDiscountPercent, adminPrice, promotion, tier } = input;
  const standard = retail !== null ? pctOff(retail, brandDiscountPercent) : null;

  // The admin's price replaces the standard one. Below standard it's a sale; above, it's just the price.
  const base = adminPrice ?? standard;
  if (base === null) return { price: null, compareAt: null, reason: null };
  const regular = standard !== null && adminPrice !== null ? Math.max(standard, adminPrice) : base;

  type Candidate = { price: number; reason: PriceReason | null };
  const candidates: Candidate[] = [{ price: base, reason: adminPrice !== null && standard !== null && adminPrice < standard ? { kind: "sale", label: "Sale" } : null }];
  if (promotion) candidates.push({ price: pctOff(base, promotion.percentOff), reason: { kind: "promotion", label: promotion.title } });
  // Tier pricing is its own % off retail and never stacks with a sale or promotion.
  if (tier && retail !== null) candidates.push({ price: pctOff(retail, tier.percentOff), reason: { kind: "tier", label: `${tier.name} price` } });

  // Lowest wins; on a tie, keep the earlier (simpler) reason.
  const best = candidates.reduce((a, b) => (b.price < a.price ? b : a));
  const discounted = best.price < regular;
  return { price: best.price, compareAt: discounted ? regular : null, reason: discounted ? best.reason : null };
}

/** The promotion with the biggest % off among those running now that cover the item. */
export function bestPromotion<P extends PricedPromotion>(promos: P[], item: { store: string; categories: string[]; sku: string | null }, now = Date.now()): P | null {
  let best: P | null = null;
  for (const p of promos) {
    if (!(p.percentOff > 0) || !isCurrent(p.startsAt, p.endsAt, now) || !inScope(p, item)) continue;
    if (!best || p.percentOff > best.percentOff) best = p;
  }
  return best;
}

/**
 * Split `targetCents` of discount across lines in proportion to their totals. Each line
 * gets whole cents; the rounding remainder goes to the largest line, so the shares always
 * add up exactly to the target and no line goes below zero.
 */
export function allocateDiscount(targetCents: number, lines: { key: number; unitCents: number; quantity: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  const totals = lines.map((l) => ({ key: l.key, cents: l.unitCents * l.quantity }));
  const sum = totals.reduce((s, l) => s + l.cents, 0);
  if (!sum || targetCents <= 0) return out;
  const target = Math.min(targetCents, sum);
  let allocated = 0;
  for (const l of totals) {
    const share = Math.floor((target * l.cents) / sum);
    out.set(l.key, share);
    allocated += share;
  }
  const largest = totals.reduce((a, b) => (b.cents > a.cents ? b : a));
  out.set(largest.key, (out.get(largest.key) ?? 0) + (target - allocated));
  return out;
}
