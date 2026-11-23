import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth/token";

/** Everything is behind sign-in except these. */
const PUBLIC = [
  "/login", "/request-access", "/forgot-password", "/set-password", "/legal", "/contact", "/studio",
  "/api/webhooks", "/api/cron", "/api/revalidate", "/api/track",
  // Checks the portal session itself and answers 401/403, so Studio can show a sign-in hint.
  "/api/admin/stats",
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
