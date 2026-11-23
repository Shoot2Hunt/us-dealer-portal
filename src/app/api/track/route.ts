import { NextResponse, type NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { db, pageViews } from "@/lib/db";
import { readSession, SESSION_COOKIE } from "@/lib/auth/token";

/** Crawlers, uptime checkers and link previews don't count as visitors. */
const BOT = /bot|crawl|spider|slurp|preview|fetch|monitor|lighthouse|headless|curl|wget|python|axios|node-fetch|vercel/i;

function device(ua: string) {
  if (/ipad|tablet|kindle|silk|playbook/i.test(ua)) return "tablet";
  if (/mobi|iphone|android/i.test(ua)) return "mobile";
  return "desktop";
}

/**
 * Page-view beacon from components/page-view-tracker.tsx. Public (signed-out pages count
 * too). Stores no IP or cookie: visitors are a salted hash that changes every day.
 */
export async function POST(req: NextRequest) {
  const ok = new NextResponse(null, { status: 204 });
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT.test(ua) || req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1") return ok;

  const body = (await req.json().catch(() => null)) as { path?: unknown; referrer?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path.split(/[?#]/)[0]!.slice(0, 200) : "";
  if (!path.startsWith("/") || path.startsWith("/api") || path.startsWith("/studio") || path.startsWith("/_next")) return ok;

  let referrerHost: string | null = null;
  if (typeof body?.referrer === "string" && body.referrer) {
    try {
      const host = new URL(body.referrer).host.replace(/^www\./, "");
      if (host && host !== req.nextUrl.host.replace(/^www\./, "")) referrerHost = host.slice(0, 100);
    } catch {}
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const secret = process.env.SESSION_SECRET ?? "";
  const visitor = createHmac("sha256", secret).update(`${day}|${ip}|${ua}`).digest("base64url").slice(0, 22);
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  const country = req.headers.get("x-vercel-ip-country");

  try {
    await db()
      .insert(pageViews)
      .values({
        path,
        referrerHost,
        visitor,
        userId: session?.sub ?? null,
        role: session?.role ?? null,
        country: country && /^[A-Z]{2}$/.test(country) ? country : null,
        device: device(ua),
      });
  } catch (err) {
    console.error("[track]", err); // statistics must never break a page
  }
  return ok;
}
