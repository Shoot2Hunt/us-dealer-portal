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
  if (!parsed.success) {
    // Say which field is wrong. Our own messages are used as-is; zod's built-in ones get a field name.
    const issue = parsed.error.issues[0];
    const field = issue?.path.filter((p) => typeof p === "string").at(-1);
    const LABELS: Record<string, string> = {
      firstName: "First name", lastName: "Last name", company: "Business", address1: "Address", address2: "Address line 2",
      city: "City", state: "State", postcode: "ZIP", phone: "Phone", poNumber: "PO number", notes: "Notes", quantity: "Quantity",
      amount: "Payment amount", lines: "Cart", payments: "Payments", discountCode: "Discount code",
    };
    const custom = issue?.code === "invalid_format" || issue?.code === "custom";
    const error = issue
      ? custom
        ? issue.message
        : `${LABELS[String(field)] ?? "Your order"}: ${issue.code === "too_big" ? "too long or too large" : issue.code === "too_small" ? "required or too small" : "isn't valid"}.`
      : "Check your shipping and payment details.";
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }
  try {
    const result = await placeOrder(user, parsed.data);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    console.error("[checkout]", err);
    return NextResponse.json({ ok: false, error: "Something went wrong placing your order. You have not been charged unless you get a confirmation email." }, { status: 500 });
  }
}
