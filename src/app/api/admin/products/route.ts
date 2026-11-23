import { NextResponse, type NextRequest } from "next/server";
import { and, eq, ilike, or } from "drizzle-orm";
import { db, inventory } from "@/lib/db";
import { getApiUser, isAdmin } from "@/lib/auth/session";
import { getBrands } from "@/sanity/content";
import { storeName } from "@/lib/woo/stores";

export type AdminProduct = {
  store: string;
  brandName: string;
  sku: string | null;
  name: string;
  imageUrl: string | null;
  retailPrice: number | null;
  /** Retail minus the brand's default dealer discount: the "regular" dealer price. */
  regularPrice: number | null;
  brandDiscountPercent: number;
};

/**
 * Product lookup for Studio → Product settings (finder + price preview). Admins only;
 * Studio runs on this site, so the portal session cookie comes along.
 *   ?q=text            search name/SKU (up to 15 results)
 *   ?store=x&sku=y     one exact product
 */
export async function GET(req: NextRequest) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "signin" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  const store = sp.get("store");
  const sku = sp.get("sku");
  let where;
  if (store && sku) where = and(eq(inventory.store, store), eq(inventory.sku, sku));
  else if (q.length >= 2) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where = or(ilike(inventory.name, like), ilike(inventory.sku, like));
  } else return NextResponse.json({ products: [] });

  const [rows, brands] = await Promise.all([
    db()
      .select({ store: inventory.store, sku: inventory.sku, name: inventory.name, imageUrl: inventory.imageUrl, retailPrice: inventory.retailPrice })
      .from(inventory)
      .where(where)
      .limit(store && sku ? 1 : 15),
    getBrands(),
  ]);
  const products: AdminProduct[] = rows.map((r) => {
    const brand = brands.find((b) => b.storeKey === r.store);
    const discount = brand?.dealerDiscountPercent ?? 0;
    const retail = r.retailPrice ? Number(r.retailPrice) : null;
    return {
      store: r.store,
      brandName: brand?.name ?? storeName(r.store),
      sku: r.sku,
      name: r.name,
      imageUrl: r.imageUrl,
      retailPrice: retail,
      regularPrice: retail !== null ? Math.round(retail * (100 - discount)) / 100 : null,
      brandDiscountPercent: discount,
    };
  });
  return NextResponse.json({ products }, { headers: { "Cache-Control": "no-store" } });
}
