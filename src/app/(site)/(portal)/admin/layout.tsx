import Link from "next/link";
import { and, count, eq, gt } from "drizzle-orm";
import { db, emailLog } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";

/** Failed emails in the last week, shown as a badge so problems don't go unnoticed. */
async function recentEmailFailures(): Promise<number> {
  try {
    const since = new Date(Date.now() - 7 * 864e5);
    const [row] = await db().select({ n: count() }).from(emailLog).where(and(eq(emailLog.status, "failed"), gt(emailLog.createdAt, since)));
    return row?.n ?? 0;
  } catch {
    return 0; // The badge is a nice-to-have; never break the admin area over it.
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const isSuper = admin.role === "super_admin";
  const failures = isSuper ? await recentEmailFailures() : 0;
  const links: [string, string][] = [
    ["/admin", "Access requests"],
    ["/admin/dealers", "Dealers"],
    ["/admin/orders", "Orders"],
    ...(isSuper ? ([["/admin/emails", "Emails"], ["/admin/sync", "Store sync"]] as [string, string][]) : []),
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3 text-sm">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="rounded px-3 py-1.5 hover:bg-panel">
            {label}
            {href === "/admin/emails" && failures > 0 && (
              <span className="badge ml-1.5 bg-red-100 text-red-800" title="Failed emails in the last 7 days">{failures}</span>
            )}
          </Link>
        ))}
        <a href="/studio" className="ml-auto btn-ghost" target="_blank">Edit content in Sanity Studio ↗</a>
      </div>
      {isSuper && failures > 0 && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {failures} email{failures === 1 ? "" : "s"} failed to send in the last 7 days.{" "}
          <Link href="/admin/emails?status=failed" className="font-medium underline">Review and retry</Link>
        </p>
      )}
      {children}
    </div>
  );
}
