import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db, emailLog } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { retryEmail } from "../actions";

const STATUS_STYLE = {
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  logged: "bg-panel text-muted",
} as const;

export default async function EmailLogPage({ searchParams }: PageProps<"/admin/emails">) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") redirect("/admin");
  const { status } = await searchParams;
  const onlyFailed = status === "failed";

  const rows = await db()
    .select({
      id: emailLog.id, kind: emailLog.kind, to: emailLog.to, subject: emailLog.subject, status: emailLog.status,
      attempts: emailLog.attempts, error: emailLog.error, createdAt: emailLog.createdAt, updatedAt: emailLog.updatedAt,
      // Only whether a body exists (retryable), never the body itself.
      hasBody: sql<boolean>`${emailLog.body} is not null`,
    })
    .from(emailLog)
    .where(onlyFailed ? eq(emailLog.status, "failed") : undefined)
    .orderBy(desc(emailLog.createdAt))
    .limit(200);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email log</h1>
          <p className="text-sm text-muted">
            The last 200 emails the portal sent. Failed sends were retried 3 times automatically. Password-link emails can&apos;t be
            re-sent as-is; use &quot;Send password link&quot; on the Dealers page instead.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/admin/emails" className={onlyFailed ? "btn-ghost" : "btn"}>All</Link>
          <Link href="/admin/emails?status=failed" className={onlyFailed ? "btn" : "btn-ghost"}>Failed only</Link>
        </div>
      </div>

      {!rows.length && <p className="text-muted">{onlyFailed ? "No failed emails. 🎉" : "No emails sent yet."}</p>}

      {!!rows.length && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-panel text-xs text-muted">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{r.createdAt.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={`badge ${STATUS_STYLE[r.status]}`}>{r.status === "logged" ? "not sent (dev)" : r.status}</span>
                    {r.attempts > 1 && <span className="ml-1 text-xs text-muted">{r.attempts} tries</span>}
                  </td>
                  <td className="px-3 py-2">{r.to.join(", ")}</td>
                  <td className="px-3 py-2">
                    <p>{r.subject}</p>
                    <p className="text-xs text-muted">{r.kind}</p>
                    {r.status === "failed" && r.error && <p className="mt-1 break-all text-xs text-red-700">{r.error}</p>}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === "failed" && r.hasBody && (
                      <form action={retryEmail}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn-ghost">Retry</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
