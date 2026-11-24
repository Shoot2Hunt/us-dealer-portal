import "server-only";
import { and, eq, getTableColumns, inArray } from "drizzle-orm";
import { db, inventory, type InventoryRow, type ProductAttribute, type ProductSpec, type User } from "@/lib/db";
import { getBrands, getProductOverrides, getPromotions, type Brand, type ProductOverride, type Promotion } from "@/sanity/content";
import { bestPromotion, computePrice, isCurrent, type PriceReason } from "@/lib/pricing";
import { hasCurrentSot } from "@/lib/auth/session";
import { storeName } from "@/lib/woo/stores";
import { getTierStatus, type Tier } from "@/lib/tiers";

/** What a dealer sees for one product or variation. Safe to send to the browser. */
export type CatalogItem = {
  id: number;
  store: string;
  brandName: string;
  /** Brand color from Sanity (#rrggbb), when set. */
  brandColor?: string;
  productId: number;
  variationId: number;
  name: string;
  sku: string | null;
  categories: string[];
  stockQuantity: number | null;
  stockStatus: string;
  inStock: boolean;
  retailPrice: number | null;
  /** What this dealer pays: the lowest of the admin/sale price, promotion and tier price (src/lib/pricing.ts). */
  dealerPrice: number | null;
  /** The regular dealer price, shown crossed out, when dealerPrice is lower. */
  compareAtPrice: number | null;
  /** Why dealerPrice is lower: a sale, a promotion (its title) or the dealer's tier. */
  priceReason: PriceReason | null;
  minQuantity: number;
  featured: boolean;
  dealerNote?: string;
  imageUrl: string | null;
  /** The product page on the brand's own store, when it is a plain http(s) link. */
  productUrl: string | null;
  /** Set when this dealer can't order the item, e.g. SOT required. */
  restriction?: string;
  updatedAt: string;
};

export type CatalogContext = {
  brands: Brand[];
  overrides: Map<string, ProductOverride>;
  /** The viewing dealer's volume tier (src/lib/tiers.ts), if they have one. */
  tier: Tier | null;
  /** Promotions with an automatic % off (Studio → Promotions). */
  promotions: Promotion[];
};

/** Pass the user so their volume tier is applied to prices. */
export async function loadCatalogContext(user: User): Promise<CatalogContext> {
  const [brands, overrides, tier, promotions] = await Promise.all([
    getBrands(),
    getProductOverrides(),
    user.role === "dealer" ? getTierStatus(user.id).then((s) => s.tier) : null,
    getPromotions(),
  ]);
  return {
    brands,
    overrides: overrideIndex(overrides),
    tier,
    promotions: promotions.filter((p) => p.percentOff > 0),
  };
}

function visibleStores(user: User, ctx: CatalogContext): string[] | null {
  const inactive = new Set(ctx.brands.filter((b) => !b.active).map((b) => b.storeKey));
  const allowed = user.allowedBrands?.length ? user.allowedBrands : null;
  if (!allowed && !inactive.size) return null; // everything
  const all = ["unknown-suppressors", "unknown-munitions", "salmon-river-solutions", "shoot2hunt"];
  return (allowed ?? all).filter((s) => !inactive.has(s));
}

/** Columns the list view needs; the detail-page fields stay out of the 10-second poll. */
const DETAIL_ONLY = ["description", "shortDescription", "images", "attributes", "specs"] as const;
type CatalogRow = Omit<InventoryRow, (typeof DETAIL_ONLY)[number]>;
const listColumns = Object.fromEntries(
  Object.entries(getTableColumns(inventory)).filter(([k]) => !(DETAIL_ONLY as readonly string[]).includes(k)),
) as { [K in keyof CatalogRow]: ReturnType<typeof getTableColumns<typeof inventory>>[K] };

export function toCatalogItem(row: CatalogRow, user: User, ctx: CatalogContext): CatalogItem | null {
  const brand = ctx.brands.find((b) => b.storeKey === row.store);
  // Match by WooCommerce product/variation id (unique, always present), then by SKU.
  const o = ctx.overrides.get(overrideKey.byId(row.store, row.productId, row.variationId)) ?? (row.sku ? ctx.overrides.get(overrideKey.bySku(row.store, row.sku)) : undefined);
  if (o?.hidden) return null;

  const retail = row.retailPrice ? Number(row.retailPrice) : null;
  const priced = computePrice({
    retail,
    brandDiscountPercent: brand?.dealerDiscountPercent ?? 0,
    // The admin's price only counts inside its optional sale dates.
    adminPrice: typeof o?.dealerPrice === "number" && isCurrent(o.saleStarts, o.saleEnds) ? o.dealerPrice : null,
    promotion: bestPromotion(ctx.promotions, row),
    tier: ctx.tier,
  });

  let restriction: string | undefined;
  const needsSot = brand?.sotRequiredCategories?.some((c) => row.categories.includes(c));
  if (needsSot && !hasCurrentSot(user)) restriction = "Requires a verified, current SOT on file";

  const inStock = row.stockStatus === "instock" || row.stockStatus === "onbackorder";
  return {
    id: row.id,
    store: row.store,
    brandName: brand?.name ?? storeName(row.store),
    brandColor: brand?.color && /^#[0-9a-f]{6}$/i.test(brand.color) ? brand.color : undefined,
    productId: row.productId,
    variationId: row.variationId,
    name: row.name,
    sku: row.sku,
    categories: row.categories,
    stockQuantity: row.manageStock ? row.stockQuantity : null,
    stockStatus: row.stockStatus,
    inStock: inStock && (!row.manageStock || row.stockStatus === "onbackorder" || (row.stockQuantity ?? 0) > 0),
    retailPrice: retail,
    dealerPrice: priced.price,
    compareAtPrice: priced.compareAt,
    priceReason: priced.reason,
    minQuantity: o?.minQuantity ?? 1,
    featured: o?.featured ?? false,
    dealerNote: o?.dealerNote,
    imageUrl: row.imageUrl,
    productUrl: row.permalink && /^https?:\/\//i.test(row.permalink) ? row.permalink : null,
    restriction,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getCatalog(user: User, ctx?: CatalogContext): Promise<CatalogItem[]> {
  const c = ctx ?? (await loadCatalogContext(user));
  const stores = visibleStores(user, c);
  const rows = await db()
    .select(listColumns)
    .from(inventory)
    .where(stores ? inArray(inventory.store, stores.length ? stores : ["__none__"]) : undefined);
  return rows
    .map((r) => toCatalogItem(r, user, c))
    .filter((x): x is CatalogItem => x !== null)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.brandName.localeCompare(b.brandName) || a.name.localeCompare(b.name));
}

/** One purchasable option on the detail page. */
export type ProductVariant = CatalogItem & {
  /** e.g. [{ name: "Caliber", option: "9mm" }]; empty for simple products. */
  attributes: ProductAttribute[];
  /** Short label for the picker, e.g. "9mm / Black". */
  label: string;
};

export type ProductDetail = {
  store: string;
  productId: number;
  brandName: string;
  /** Brand color from Sanity (#rrggbb), when set. */
  brandColor?: string;
  name: string;
  categories: string[];
  /** Raw WooCommerce HTML; sanitize before rendering. */
  description: string | null;
  shortDescription: string | null;
  images: string[];
  specs: ProductSpec[];
  productUrl: string | null;
  variants: ProductVariant[];
};

/**
 * A product and every variation this dealer may see, for /inventory/[store]/[id].
 * Same brand visibility, hidden-product and pricing rules as the inventory list.
 */
export async function getProduct(user: User, store: string, productId: number): Promise<ProductDetail | null> {
  const ctx = await loadCatalogContext(user);
  const stores = visibleStores(user, ctx);
  if (stores && !stores.includes(store)) return null;

  const rows = await db()
    .select()
    .from(inventory)
    .where(and(eq(inventory.store, store), eq(inventory.productId, productId)));

  const variants: ProductVariant[] = [];
  for (const r of rows) {
    const item = toCatalogItem(r, user, ctx);
    if (!item) continue;
    const label =
      r.attributes.map((a) => a.option).join(" / ") ||
      (r.parentName && r.name.startsWith(r.parentName) ? r.name.slice(r.parentName.length).replace(/^\s*[—-]\s*/, "") : "") ||
      r.name;
    variants.push({ ...item, attributes: r.attributes, label });
  }
  if (!variants.length) return null;
  variants.sort((a, b) => a.variationId - b.variationId);

  const first = rows.find((r) => r.id === variants[0]!.id)!;
  // Prefer the product-level page (without a variation's attribute query string).
  const productUrl = variants[0]!.productUrl?.split("?")[0] ?? null;
  return {
    store,
    productId,
    brandName: variants[0]!.brandName,
    brandColor: variants[0]!.brandColor,
    name: first.parentName ?? first.name,
    categories: first.categories,
    description: first.description,
    shortDescription: first.shortDescription,
    images: first.images,
    specs: first.specs,
    productUrl,
    variants,
  };
}

/** Shipping restrictions from the brand settings in Sanity. */
export function shippingBlock(item: CatalogItem, state: string, ctx: CatalogContext): string | null {
  const brand = ctx.brands.find((b) => b.storeKey === item.store);
  for (const r of brand?.shippingRestrictions ?? []) {
    const applies = !r.categorySlug || item.categories.includes(r.categorySlug);
    if (applies && r.states?.includes(state.toUpperCase())) {
      return r.message || `${item.name} can't ship to ${state.toUpperCase()}.`;
    }
  }
  return null;
}

/** Keys for looking up Product settings: by WooCommerce ids, or by SKU for older settings. */
export const overrideKey = {
  byId: (store: string, productId: number, variationId: number) => `id:${store}:${productId}:${variationId}`,
  bySku: (store: string, sku: string) => `sku:${store}:${sku.trim().toLowerCase()}`,
};

function overrideIndex(overrides: ProductOverride[]): Map<string, ProductOverride> {
  const m = new Map<string, ProductOverride>();
  for (const o of overrides) {
    if (!o.storeKey) continue;
    if (typeof o.productId === "number") m.set(overrideKey.byId(o.storeKey, o.productId, o.variationId ?? 0), o);
    else if (o.sku) m.set(overrideKey.bySku(o.storeKey, o.sku), o);
  }
  return m;
}
