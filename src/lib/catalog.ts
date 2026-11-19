import "server-only";
import { inArray } from "drizzle-orm";
import { db, inventory, type InventoryRow, type User } from "@/lib/db";
import { getBrands, getProductOverrides, type Brand, type ProductOverride } from "@/sanity/content";
import { hasCurrentSot } from "@/lib/auth/session";
import { storeName } from "@/lib/woo/stores";

/** What a dealer sees for one product or variation. Safe to send to the browser. */
export type CatalogItem = {
  id: number;
  store: string;
  brandName: string;
  productId: number;
  variationId: number;
  name: string;
  sku: string | null;
  categories: string[];
  stockQuantity: number | null;
  stockStatus: string;
  inStock: boolean;
  retailPrice: number | null;
  dealerPrice: number | null;
  minQuantity: number;
  featured: boolean;
  dealerNote?: string;
  imageUrl: string | null;
  /** Set when this dealer can't order the item, e.g. SOT required. */
  restriction?: string;
  updatedAt: string;
};

export type CatalogContext = { brands: Brand[]; overrides: Map<string, ProductOverride> };

export async function loadCatalogContext(): Promise<CatalogContext> {
  const [brands, overrides] = await Promise.all([getBrands(), getProductOverrides()]);
  return { brands, overrides: new Map(overrides.filter((o) => o.sku).map((o) => [`${o.storeKey}:${o.sku}`, o])) };
}

function visibleStores(user: User, ctx: CatalogContext): string[] | null {
  const inactive = new Set(ctx.brands.filter((b) => !b.active).map((b) => b.storeKey));
  const allowed = user.allowedBrands?.length ? user.allowedBrands : null;
  if (!allowed && !inactive.size) return null; // everything
  const all = ["unknown-suppressors", "unknown-munitions", "salmon-river-solutions", "shoot2hunt"];
  return (allowed ?? all).filter((s) => !inactive.has(s));
}

export function toCatalogItem(row: InventoryRow, user: User, ctx: CatalogContext): CatalogItem | null {
  const brand = ctx.brands.find((b) => b.storeKey === row.store);
  const o = row.sku ? ctx.overrides.get(`${row.store}:${row.sku}`) : undefined;
  if (o?.hidden) return null;

  const retail = row.retailPrice ? Number(row.retailPrice) : null;
  const discount = brand?.dealerDiscountPercent ?? 0;
  const dealerPrice = o?.dealerPrice ?? (retail !== null ? Math.round(retail * (100 - discount)) / 100 : null);

  let restriction: string | undefined;
  const needsSot = brand?.sotRequiredCategories?.some((c) => row.categories.includes(c));
  if (needsSot && !hasCurrentSot(user)) restriction = "Requires a verified, current SOT on file";

  const inStock = row.stockStatus === "instock" || row.stockStatus === "onbackorder";
  return {
    id: row.id,
    store: row.store,
    brandName: brand?.name ?? storeName(row.store),
    productId: row.productId,
    variationId: row.variationId,
    name: row.name,
    sku: row.sku,
    categories: row.categories,
    stockQuantity: row.manageStock ? row.stockQuantity : null,
    stockStatus: row.stockStatus,
    inStock: inStock && (!row.manageStock || row.stockStatus === "onbackorder" || (row.stockQuantity ?? 0) > 0),
    retailPrice: retail,
    dealerPrice,
    minQuantity: o?.minQuantity ?? 1,
    featured: o?.featured ?? false,
    dealerNote: o?.dealerNote,
    imageUrl: row.imageUrl,
    restriction,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getCatalog(user: User, ctx?: CatalogContext): Promise<CatalogItem[]> {
  const c = ctx ?? (await loadCatalogContext());
  const stores = visibleStores(user, c);
  const rows = await db()
    .select()
    .from(inventory)
    .where(stores ? inArray(inventory.store, stores.length ? stores : ["__none__"]) : undefined);
  return rows
    .map((r) => toCatalogItem(r, user, c))
    .filter((x): x is CatalogItem => x !== null)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.brandName.localeCompare(b.brandName) || a.name.localeCompare(b.name));
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
