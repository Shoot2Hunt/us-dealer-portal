import "server-only";
import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Compared in constant time. */
export function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Hash both sides so the comparison is the same length whatever was sent.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}
