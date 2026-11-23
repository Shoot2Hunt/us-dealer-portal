import { NextResponse, type NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db, inventory } from "@/lib/db";
import { getApiUser } from "@/lib/auth/session";
import { loadCatalogContext, toCatalogItem } from "@/lib/catalog";
import { evaluateDiscount, type DiscountLine } from "@/lib/discounts";

const body = z.object({
  code: z.string().trim().min(1).max(30),
  lines: z.array(z.object({ id: z.number().int(), quantity: z.number().int().min(1) })).min(1).max(200),
});

/**
 * Checkout preview: is this code valid for this cart, and how much does it take off?
 * The order is re-checked from scratch when it's placed, so this is informational only.
 */
export async function POST(req: NextRequest) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Enter a discount code." }, { status: 400 });

  const ids = parsed.data.lines.map((l) => l.id);
  const [rows, ctx] = await Promise.all([db().select().from(inventory).where(inArray(inventory.id, ids)), loadCatalogContext(user)]);
  const lines: DiscountLine[] = [];
  parsed.data.lines.forEach((l, key) => {
    const row = rows.find((r) => r.id === l.id);
    const item = row && toCatalogItem(row, user, ctx);
    if (item && item.dealerPrice !== null) {
      lines.push({ key, store: item.store, categories: item.categories, sku: item.sku, unitCents: Math.round(item.dealerPrice * 100), quantity: l.quantity });
    }
  });
  if (!lines.length) return NextResponse.json({ ok: false, error: "Your cart is empty." });

  const r = await evaluateDiscount(parsed.data.code, user, lines);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error });
  return NextResponse.json({ ok: true, code: r.code, description: r.description ?? null, discount: r.discountCents / 100 });
}
