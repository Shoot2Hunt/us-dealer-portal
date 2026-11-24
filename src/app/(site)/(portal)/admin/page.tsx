import { and, desc, eq } from "drizzle-orm";
import { accessRequests, db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { docsForRequests } from "@/lib/license-docs";
import { storeName } from "@/lib/woo/stores";
import { LicenseDocPreview } from "@/components/license-doc-preview";
import { approveRequest, denyRequest } from "./actions";

export default async function AdminRequestsPage() {
  const admin = await requireAdmin();
  const mine = admin.role === "brand_admin" && admin.brandSlug ? eq(accessRequests.brandSlug, admin.brandSlug) : undefined;
  const pending = await db().select().from(accessRequests).where(and(eq(accessRequests.status, "pending"), mine)).orderBy(desc(accessRequests.createdAt));
  // Only requests this admin can already see, so brand admins never get another brand's files.
  const docs = await docsForRequests(pending.map((r) => r.id));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Access requests</h1>
      {!pending.length && <p className="text-muted">No pending requests.</p>}
      {pending.map((r) => (
        <div key={r.id} className="card grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-1 text-sm">
            <p className="text-base font-semibold">{r.company}</p>
            <p>{r.name} · {r.email}{r.phone && ` · ${r.phone}`}</p>
            <p className="text-muted">Via {storeName(r.brandSlug)} · {r.createdAt.toLocaleDateString()}</p>
            <p>FFL <strong>{r.fflNumber}</strong>{r.fflExpires && ` (expires ${r.fflExpires})`}</p>
            <p>
              SOT:{" "}
              {r.hasSot ? (
                <>
                  <strong>{r.sotNumber ?? "number not given"}</strong>
                  {r.sotExpires && ` (expires ${r.sotExpires})`}
                </>
              ) : (
                "none given"
              )}
            </p>
            {r.message && <p className="rounded bg-panel p-2">{r.message}</p>}
            <div className="pt-2">
              <LicenseDocPreview docs={docs.filter((d) => d.accessRequestId === r.id)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <form action={approveRequest} className="space-y-2 rounded-md border border-line p-3 text-sm">
              <input type="hidden" name="id" value={r.id} />
              <label className="flex items-center gap-2"><input type="checkbox" name="sotVerified" /> SOT verified</label>
              <label className="block">SOT expires <input type="date" name="sotExpires" defaultValue={r.sotExpires ?? ""} className="input mt-1" /></label>
              <button className="btn w-full">Verify FFL &amp; approve</button>
            </form>
            <form action={denyRequest} className="space-y-2 text-sm">
              <input type="hidden" name="id" value={r.id} />
              <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="notify" defaultChecked /> Email the dealer</label>
              <button className="btn-ghost w-full">Deny</button>
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}
