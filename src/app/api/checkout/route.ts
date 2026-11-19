import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { checkoutSchema, placeOrder } from "@/lib/orders";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
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
