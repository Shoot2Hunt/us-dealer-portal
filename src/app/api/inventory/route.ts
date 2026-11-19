import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getCatalog } from "@/lib/catalog";

/** Polled by the inventory page every few seconds for live stock. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const items = await getCatalog(user);
  return NextResponse.json({ items, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
