import type { CatalogItem } from "@/lib/catalog";

/**
 * Inventory filters, sorting and paging. Pure functions, run in the browser on
 * the live catalog. The state round-trips through the URL query string, so a
 * filtered view survives refresh and the back button and can be shared.
 */

export type StockFilter = "any" | "available" | "instock" | "backorder" | "out";
export type SortKey = "featured" | "name" | "price-asc" | "price-desc" | "stock" | "updated";

export type Filters = {
  q: string;
  brands: string[];
  cats: string[];
  stock: StockFilter;
  min: string;
  max: string;
  orderable: boolean;
  featured: boolean;
  /** Only items with a sale, promotion or tier price below the regular dealer price. */
  sale: boolean;
  sort: SortKey;
  size: number;
  page: number;
};

export const PAGE_SIZES = [25, 50, 100] as const;

export const STOCK_OPTIONS: [StockFilter, string][] = [
  ["any", "Any availability"],
  ["available", "Available (in stock or backorder)"],
  ["instock", "In stock now"],
  ["backorder", "Backorder only"],
  ["out", "Out of stock"],
];

export const SORT_OPTIONS: [SortKey, string][] = [
  ["featured", "Featured first"],
  ["name", "Name A–Z"],
  ["price-asc", "Dealer price: low to high"],
  ["price-desc", "Dealer price: high to low"],
  ["stock", "Most in stock"],
  ["updated", "Recently updated"],
];

export const DEFAULT_FILTERS: Filters = {
  q: "", brands: [], cats: [], stock: "any", min: "", max: "", orderable: false, featured: false, sale: false, sort: "featured", size: 50, page: 1,
};

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);
const oneOf = <T extends string>(v: string | null, options: [T, string][], fallback: T): T =>
  options.some(([k]) => k === v) ? (v as T) : fallback;

export function filtersFromParams(p: URLSearchParams): Filters {
  const size = Number(p.get("size"));
  const page = Number(p.get("page"));
  return {
    q: p.get("q") ?? "",
    brands: list(p.get("brand")),
    cats: list(p.get("cat")),
    stock: oneOf(p.get("stock"), STOCK_OPTIONS, "any"),
    min: p.get("min") ?? "",
    max: p.get("max") ?? "",
    orderable: p.get("orderable") === "1",
    featured: p.get("featured") === "1",
    sale: p.get("sale") === "1",
    sort: oneOf(p.get("sort"), SORT_OPTIONS, "featured"),
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_FILTERS.size,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Only non-default values go in the URL, to keep it short. */
export function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.brands.length) p.set("brand", f.brands.join(","));
  if (f.cats.length) p.set("cat", f.cats.join(","));
  if (f.stock !== "any") p.set("stock", f.stock);
  if (f.min) p.set("min", f.min);
  if (f.max) p.set("max", f.max);
  if (f.orderable) p.set("orderable", "1");
  if (f.featured) p.set("featured", "1");
  if (f.sale) p.set("sale", "1");
  if (f.sort !== "featured") p.set("sort", f.sort);
  if (f.size !== DEFAULT_FILTERS.size) p.set("size", String(f.size));
  if (f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** "ammo-9mm" → "Ammo 9mm". Categories are stored as WooCommerce slugs. */
export function categoryLabel(slug: string): string {
  const s = slug.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function matchesStock(i: CatalogItem, stock: StockFilter): boolean {
  switch (stock) {
    case "available": return i.inStock;
    case "instock": return i.inStock && i.stockStatus !== "onbackorder";
    case "backorder": return i.stockStatus === "onbackorder";
    case "out": return !i.inStock;
    default: return true;
  }
}

/**
 * Apply every filter except the one named in `skip`. Skipping lets the brand
 * and category lists show how many results each choice would give.
 */
export function applyFilters(items: CatalogItem[], f: Filters, skip?: "brands" | "cats"): CatalogItem[] {
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const min = f.min === "" ? null : Number(f.min);
  const max = f.max === "" ? null : Number(f.max);
  const brands = skip === "brands" ? null : f.brands.length ? new Set(f.brands) : null;
  const cats = skip === "cats" ? null : f.cats.length ? new Set(f.cats) : null;

  return items.filter((i) => {
    if (brands && !brands.has(i.store)) return false;
    if (cats && !i.categories.some((c) => cats.has(c))) return false;
    if (!matchesStock(i, f.stock)) return false;
    if (f.orderable && (i.restriction || !i.inStock || i.dealerPrice === null)) return false;
    if (f.featured && !i.featured) return false;
    if (f.sale && i.compareAtPrice === null) return false;
    if ((min !== null && !Number.isNaN(min)) || (max !== null && !Number.isNaN(max))) {
      if (i.dealerPrice === null) return false;
      if (min !== null && !Number.isNaN(min) && i.dealerPrice < min) return false;
      if (max !== null && !Number.isNaN(max) && i.dealerPrice > max) return false;
    }
    if (terms.length) {
      // Every word must appear somewhere: name, SKU, brand or category.
      const hay = `${i.name} ${i.sku ?? ""} ${i.brandName} ${i.categories.join(" ")}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

/** Stock sort key: real quantities first, then in stock with untracked quantity, then out of stock. */
const stockRank = (i: CatalogItem) => (!i.inStock ? -2 : i.stockQuantity ?? -1);
const byName = (a: CatalogItem, b: CatalogItem) => a.name.localeCompare(b.name);
/** Items without a dealer price always sort last. */
const priceOf = (i: CatalogItem, dir: 1 | -1) => (i.dealerPrice === null ? Infinity : i.dealerPrice * dir);

export function sortItems(items: CatalogItem[], sort: SortKey): CatalogItem[] {
  const out = [...items];
  switch (sort) {
    case "name": return out.sort(byName);
    case "price-asc": return out.sort((a, b) => priceOf(a, 1) - priceOf(b, 1) || byName(a, b));
    case "price-desc": return out.sort((a, b) => priceOf(a, -1) - priceOf(b, -1) || byName(a, b));
    case "stock": return out.sort((a, b) => stockRank(b) - stockRank(a) || byName(a, b));
    case "updated": return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byName(a, b));
    default: return items; // the server already orders by featured, brand, name
  }
}

/** Count how many items fall under each key (brand or category). */
export function countBy(items: CatalogItem[], keys: (i: CatalogItem) => string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) for (const k of new Set(keys(i))) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

/** Page numbers to show, with null for a "…" gap: 1 … 4 5 6 … 20 */
export function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, idx) => {
    if (idx && n - sorted[idx - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}
