import { NextResponse, type NextRequest } from "next/server";
import { and, asc, count, eq, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, inventory } from "@/lib/db";
import { getApiUser, isAdmin } from "@/lib/auth/session";
import { getBrands } from "@/sanity/content";
import { STORES, storeName } from "@/lib/woo/stores";

const body = z.object({
  q: z.string().trim().max(80).optional(),
  brand: z.string().max(40).optional(),
  stock: z.enum(["any", "in", "out", "backorder"]).default("any"),
  /** Only these products ("store:sku"), e.g. those that have Product settings. */
  keys: z.array(z.string().max(200)).max(5000).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
  size: z.number().int().min(10).max(100).default(50),
});

export type CatalogRow = {
  id: number;
  store: string;
  brandName: string;
  sku: string | null;
  name: string;
  imageUrl: string | null;
  retailPrice: number | null;
  /** Retail minus the brand's default dealer discount. */
  regularPrice: number | null;
  stock: "in" | "out" | "backorder";
  stockQuantity: number | null;
  productId: number;
  variationId: number;
};

export type CatalogPage = { rows: CatalogRow[]; total: number; page: number; pages: number; stores: { key: string; name: string }[] };

/**
 * Product list for Studio → Catalog → Products. Admins only (Studio runs on this site,
 * so the portal session cookie comes along). Brand admins only see their own brand.
 */
export async function POST(req: NextRequest) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "signin" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const f = parsed.data;

  const where: SQL[] = [];
  if (user.role === "brand_admin") where.push(eq(inventory.store, user.brandSlug ?? "__none__"));
  if (f.brand) where.push(eq(inventory.store, f.brand));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(inventory.name, like), ilike(inventory.sku, like))!);
  }
  if (f.stock === "out") where.push(eq(inventory.stockStatus, "outofstock"));
  if (f.stock === "backorder") where.push(eq(inventory.stockStatus, "onbackorder"));
  if (f.stock === "in") where.push(ne(inventory.stockStatus, "outofstock"));
  if (f.keys) {
    // Only products whose "store:sku" is in the list (an empty list matches nothing).
    const pairs = f.keys.map((k) => k.split(":")).filter((p) => p.length >= 2);
    if (!pairs.length) return NextResponse.json({ rows: [], total: 0, page: 1, pages: 1, stores: [] } satisfies CatalogPage);
    where.push(isNotNull(inventory.sku), inArray(sql`${inventory.store} || ':' || ${inventory.sku}`, f.keys));
  }
  const cond = where.length ? and(...where) : undefined;

  const [[{ n }], rows, brands] = await Promise.all([
    db().select({ n: count() }).from(inventory).where(cond),
    db()
      .select({
        id: inventory.id, store: inventory.store, sku: inventory.sku, name: inventory.name, imageUrl: inventory.imageUrl,
        retailPrice: inventory.retailPrice, stockStatus: inventory.stockStatus, stockQuantity: inventory.stockQuantity,
        manageStock: inventory.manageStock, productId: inventory.productId, variationId: inventory.variationId,
      })
      .from(inventory)
      .where(cond)
      .orderBy(asc(inventory.name), asc(inventory.id))
      .limit(f.size)
      .offset((f.page - 1) * f.size),
    getBrands(),
  ]);

  const out: CatalogPage = {
    total: n,
    page: f.page,
    pages: Math.max(1, Math.ceil(n / f.size)),
    stores: STORES.filter((s) => user.role !== "brand_admin" || s.key === user.brandSlug).map((s) => ({ key: s.key, name: brands.find((b) => b.storeKey === s.key)?.name ?? s.name })),
    rows: rows.map((r) => {
      const brand = brands.find((b) => b.storeKey === r.store);
      const retail = r.retailPrice ? Number(r.retailPrice) : null;
      const discount = brand?.dealerDiscountPercent ?? 0;
      return {
        id: r.id,
        store: r.store,
        brandName: brand?.name ?? storeName(r.store),
        sku: r.sku,
        name: r.name,
        imageUrl: r.imageUrl,
        retailPrice: retail,
        regularPrice: retail !== null ? Math.round(retail * (100 - discount)) / 100 : null,
        stock: r.stockStatus === "outofstock" ? "out" : r.stockStatus === "onbackorder" ? "backorder" : "in",
        stockQuantity: r.manageStock ? r.stockQuantity : null,
        productId: r.productId,
        variationId: r.variationId,
      };
    }),
  };
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
