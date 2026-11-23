import "server-only";
import { headers } from "next/headers";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, loginThrottle } from "@/lib/db";

/**
 * Fixed-window rate limits for anti-automation (sign-in floods, request-access spam,
 * code guessing…). Stored in the login_throttle table under "rl:" keys so every server
 * instance shares the count. Fails open: a database hiccup never locks people out.
 */
export async function rateLimit(key: string, max: number, windowMinutes: number): Promise<{ ok: boolean; retryMinutes: number }> {
  const windowStart = new Date(Date.now() - windowMinutes * 60_000);
  try {
    const [row] = await db()
      .insert(loginThrottle)
      .values({ key: `rl:${key}`, failures: 1, firstFailureAt: new Date() })
      .onConflictDoUpdate({
        target: loginThrottle.key,
        set: {
          failures: sql`case when ${loginThrottle.firstFailureAt} < ${windowStart} then 1 else ${loginThrottle.failures} + 1 end`,
          firstFailureAt: sql`case when ${loginThrottle.firstFailureAt} < ${windowStart} then now() else ${loginThrottle.firstFailureAt} end`,
        },
      })
      .returning({ count: loginThrottle.failures, since: loginThrottle.firstFailureAt });
    if (!row || row.count <= max) return { ok: true, retryMinutes: 0 };
    const retryMs = row.since.getTime() + windowMinutes * 60_000 - Date.now();
    return { ok: false, retryMinutes: Math.max(1, Math.ceil(retryMs / 60_000)) };
  } catch (err) {
    console.error("[rate-limit]", err);
    return { ok: true, retryMinutes: 0 };
  }
}

/** A salted hash of the caller's IP (never stored in the clear). */
export async function clientKey(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`ip|${ip}`).digest("base64url").slice(0, 22);
}

export const tooManyMessage = (minutes: number) =>
  `Too many attempts from your network. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;
