import { NextResponse, type NextRequest } from "next/server";
import { getApiUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { payInvoices, payInvoicesSchema } from "@/lib/invoices";

export const maxDuration = 60;

/** Pay open invoices (Billing page) in full or in part, by card or ACH. */
export async function POST(req: NextRequest) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  // Limits card testing with a stolen account: a few attempts per dealer per 15 minutes.
  const limit = await rateLimit(`invoice-pay:${user.id}`, 6, 15);
  if (!limit.ok) {
    return NextResponse.json({ ok: false, error: `Too many payment attempts. Please wait ${limit.retryMinutes} minute${limit.retryMinutes === 1 ? "" : "s"} and try again.` }, { status: 429 });
  }
  const parsed = payInvoicesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error =
      field === "amount" ? "Enter a payment amount." : field === "orderIds" ? "Select at least one invoice." : field === "token" ? "Payment details are missing." : "Check your payment details.";
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }
  try {
    const result = await payInvoices(user, parsed.data);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    console.error("[invoices/pay]", err);
    return NextResponse.json({ ok: false, error: "Something went wrong taking your payment. You have not been charged unless you get a receipt email." }, { status: 500 });
  }
}
