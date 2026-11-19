import "server-only";
import type { NextRequest } from "next/server";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}
