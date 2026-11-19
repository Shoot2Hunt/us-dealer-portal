import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { isCronRequest } from "@/lib/cron";
import { db, payments } from "@/lib/db";
import { getTransactionStatus } from "@/lib/authnet";
import { markPaymentProblem, releaseIfPaid } from "@/lib/orders";

export const maxDuration = 300;

const RETURNED = new Set(["returnedItem", "voided", "declined", "settlementError", "generalError", "chargeback"]);

/** Checks eCheck (ACH) payments: releases orders once settled, holds them if returned. */
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const pending = await db().select().from(payments).where(eq(payments.status, "pending_settlement"));
  const results: Record<string, string> = {};
  for (const p of pending) {
    if (!p.transId) continue;
    const status = await getTransactionStatus(p.transId);
    results[p.transId] = status ?? "unknown";
    if (status === "settledSuccessfully") {
      await db().update(payments).set({ status: "settled", updatedAt: new Date() }).where(eq(payments.id, p.id));
      await releaseIfPaid(p.orderId);
    } else if (status && RETURNED.has(status)) {
      await markPaymentProblem(p.orderId, p.id, `ACH payment ${status}`);
    }
  }
  return NextResponse.json({ checked: pending.length, results });
}
