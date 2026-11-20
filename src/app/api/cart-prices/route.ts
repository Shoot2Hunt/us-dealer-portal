import { NextResponse, type NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { db, inventory } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { loadCatalogContext, toCatalogItem } from "@/lib/catalog";

/**
 * Current prices for the items in a dealer's cart (?ids=1,2,3). The cart keeps
 * a price snapshot in the browser; this keeps it in step with the dealer's tier
 * and any Sanity price changes, so the checkout total matches what's charged.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 200);
  if (!ids.length) return NextResponse.json({ prices: {} });

  const [rows, ctx] = await Promise.all([db().select().from(inventory).where(inArray(inventory.id, ids)), loadCatalogContext(user)]);
  const prices: Record<number, number | null> = {};
  for (const r of rows) prices[r.id] = toCatalogItem(r, user, ctx)?.dealerPrice ?? null;
  return NextResponse.json({ prices }, { headers: { "Cache-Control": "no-store" } });
}
