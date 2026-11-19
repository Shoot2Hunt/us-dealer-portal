import { count } from "drizzle-orm";
import { db, inventory, syncState } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { getStore, STORES } from "@/lib/woo/stores";
import { runSync } from "../actions";

const STALE_MINUTES = 30;

export default async function SyncPage() {
  await requireAdmin();
  const states = await db().select().from(syncState);
  const staleBefore = new Date(new Date().getTime() - STALE_MINUTES * 60_000);
  const counts = await db().select({ store: inventory.store, n: count() }).from(inventory).groupBy(inventory.store);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Store sync</h1>
      <p className="text-sm text-muted">Webhooks update stock within seconds. A scheduled sync catches anything missed.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {STORES.map((s) => {
          const st = states.find((x) => x.store === s.key);
          const configured = Boolean(getStore(s.key).url);
          const last = [st?.lastSyncedAt, st?.lastWebhookAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
          const stale = !last || last < staleBefore;
          return (
            <div key={s.key} className="card space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{s.name}</h2>
                {!configured ? (
                  <span className="badge bg-panel text-muted">Not configured</span>
                ) : st?.lastError ? (
                  <span className="badge bg-red-50 text-red-700">Error</span>
                ) : stale ? (
                  <span className="badge bg-amber-50 text-amber-800">Stale</span>
                ) : (
                  <span className="badge bg-green-50 text-green-800">Healthy</span>
                )}
              </div>
              <p className="text-muted">Products: {counts.find((c) => c.store === s.key)?.n ?? 0}</p>
              <p className="text-muted">Last sync: {st?.lastSyncedAt?.toLocaleString() ?? "never"}</p>
              <p className="text-muted">Last webhook: {st?.lastWebhookAt?.toLocaleString() ?? "never"}</p>
              {st?.lastError && <p className="rounded bg-red-50 p-2 text-red-800">{st.lastError}</p>}
              {configured && (
                <form action={runSync}>
                  <input type="hidden" name="store" value={s.key} />
                  <button className="btn-ghost">Run full sync now</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const maxDuration = 300;
