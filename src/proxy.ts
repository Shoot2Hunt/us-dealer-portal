import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth/token";

/** Everything is behind sign-in except these. */
const PUBLIC = [
  "/login", "/request-access", "/forgot-password", "/set-password", "/legal", "/contact", "/studio",
  "/api/webhooks", "/api/cron", "/api/revalidate", "/api/track",
  // FFL/SOT copies from the (signed-out) request-access form. Rate-limited per network.
  "/api/license-upload",
  // Checks the portal session itself and answers 401/403, so Studio can show a sign-in hint.
  "/api/admin/stats",
];

/** Server-to-server endpoints with their own signature/secret checks (no browser Origin). */
const SIGNED_API = ["/api/webhooks", "/api/cron", "/api/revalidate"];

/**
 * CSRF defense in depth (on top of SameSite=Lax cookies and Next's own Server Action
 * origin check): browsers always label cross-site requests, so refuse any state-changing
 * API call another website tries to make on a visitor's behalf.
 */
function crossSiteWrite(req: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  if (req.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false; // not a browser (or a very old one); cookies alone can't be forged
  try {
    return new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return true;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/") && !SIGNED_API.some((p) => pathname.startsWith(p)) && crossSiteWrite(req)) {
    return NextResponse.json({ error: "cross-site request blocked" }, { status: 403 });
  }
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/admin") && session.role === "dealer") {
    return NextResponse.redirect(new URL("/inventory", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
