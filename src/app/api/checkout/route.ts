import { NextResponse, type NextRequest } from "next/server";
import { getApiUser, isAdmin } from "@/lib/auth/session";
import { getPluginSettings } from "@/sanity/content";
import { checkoutSchema, placeOrder } from "@/lib/orders";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  // Maintenance mode (Sanity → Plugins): no new orders except from admins.
  if (!isAdmin(user) && (await getPluginSettings()).maintenance.enabled) {
    return NextResponse.json({ ok: false, error: "Ordering is paused for maintenance. Please try again soon." }, { status: 503 });
  }
  const parsed = checkoutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Check your shipping and payment details." }, { status: 400 });
  try {
    const result = await placeOrder(user, parsed.data);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    console.error("[checkout]", err);
    return NextResponse.json({ ok: false, error: "Something went wrong placing your order. You have not been charged unless you get a confirmation email." }, { status: 500 });
  }
}
