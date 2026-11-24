import { asc } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { STORES, storeName } from "@/lib/woo/stores";
import { docsForUsers } from "@/lib/license-docs";
import { getTierStatuses, type TierStatus } from "@/lib/tiers";
import { LicenseDocPreview } from "@/components/license-doc-preview";
import { createAdmin, resendSetupLink, resetTwoFactor, updateDealer } from "../actions";

export default async function DealersPage() {
  const admin = await requireAdmin();
  const isSuper = admin.role === "super_admin";
  const all = await db().select().from(users).orderBy(asc(users.company), asc(users.name));
  const dealers = all.filter((u) => u.role === "dealer");
  const admins = all.filter((u) => u.role !== "dealer");
  const [docs, tiers] = await Promise.all([docsForUsers(dealers.map((d) => d.id)), getTierStatuses(dealers.map((d) => d.id))]);
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Dealers</h1>
        {!dealers.length && <p className="text-muted">No dealers yet.</p>}
        {dealers.map((d) => (
          <form key={d.id} action={updateDealer} className="card grid gap-3 text-sm md:grid-cols-[1.4fr_1fr_1fr_auto]">
            <input type="hidden" name="id" value={d.id} />
            <div>
              <p className="font-semibold">{d.company ?? d.name}</p>
              <p className="text-muted">{d.name} · {d.email}</p>
              <p className="text-muted">
                FFL {d.fflNumber ?? "—"}{!d.passwordHash && " · hasn't set a password yet"}
                {d.totpEnabledAt && <span className="badge ml-1.5 bg-green-100 text-green-800">2FA on</span>}
              </p>
              <TierLine status={tiers.get(d.id)!} />
              <div className="mt-2">
                <LicenseDocPreview compact docs={docs.filter((doc) => doc.userId === d.id)} />
              </div>
            </div>
            {/* Licence, brand access and suspension are super-admin decisions (segregation of duties). */}
            <fieldset disabled={!isSuper} className="contents" title={isSuper ? undefined : "Only super admins can change these"}>
            <div className="space-y-2">
              <label className="block">FFL expires <input type="date" name="fflExpires" defaultValue={d.fflExpires ?? ""} className="input mt-1" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" name="sotVerified" defaultChecked={d.sotVerified} /> SOT verified</label>
              <label className="block">SOT expires <input type="date" name="sotExpires" defaultValue={d.sotExpires ?? ""} className="input mt-1" /></label>
              <div className="grid grid-cols-2 gap-2 border-t border-line pt-2">
                <label className="block" title="Lets the dealer choose &quot;Invoice me&quot; at checkout. Blank = pay at checkout only.">
                  Net terms (days)
                  <input type="number" name="paymentTermsDays" min={1} max={180} step={1} placeholder="None" defaultValue={d.paymentTermsDays ?? ""} className="input mt-1" />
                </label>
                <label className="block" title="Most they can owe on invoices at once. Blank = no limit.">
                  Credit limit ($)
                  <input name="creditLimit" inputMode="decimal" placeholder="No limit" defaultValue={d.creditLimit ?? ""} className="input mt-1" />
                </label>
              </div>
            </div>
            <div className="space-y-1">
              <p className="font-medium">Brands (none checked = all)</p>
              {STORES.map((s) => (
                <label key={s.key} className="flex items-center gap-2">
                  <input type="checkbox" name="allowedBrands" value={s.key} defaultChecked={d.allowedBrands?.includes(s.key)} /> {s.name}
                </label>
              ))}
            </div>
            </fieldset>
            <div className="flex flex-col gap-2">
              <select name="status" defaultValue={d.status} className="input" disabled={!isSuper}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
              {isSuper ? <button className="btn">Save</button> : <p className="text-xs text-muted">Only super admins can change licences, brands or status.</p>}
              <button formAction={resendSetupLink} className="btn-ghost">Send password link</button>
              {admin.role === "super_admin" && d.totpEnabledAt && (
                <button formAction={resetTwoFactor} formNoValidate className="btn-ghost text-red-700" title="Turns off two-step verification and signs them out. Use when they've lost their phone and recovery codes.">
                  Reset 2FA
                </button>
              )}
            </div>
          </form>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Admins</h2>
        <ul className="card divide-y divide-line text-sm">
          {admins.map((a) => (
            <li key={a.id} className="flex justify-between py-2">
              <span>{a.name} · {a.email}</span>
              <span className="flex items-center gap-2 text-muted">
                {a.totpEnabledAt && <span className="badge bg-green-100 text-green-800">2FA on</span>}
                {a.role === "super_admin" ? "Super admin" : `Brand admin · ${storeName(a.brandSlug ?? "")}`}
                {admin.role === "super_admin" && a.totpEnabledAt && a.id !== admin.id && (
                  <form action={resetTwoFactor}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-xs text-red-700 hover:underline">Reset 2FA</button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
        {admin.role === "super_admin" && (
          <form action={createAdmin} className="card grid gap-3 text-sm md:grid-cols-5">
            <input name="name" placeholder="Name" className="input" required />
            <input name="email" type="email" placeholder="Email" className="input" required />
            <select name="role" className="input" defaultValue="brand_admin">
              <option value="brand_admin">Brand admin</option>
              <option value="super_admin">Super admin</option>
            </select>
            <select name="brandSlug" className="input">
              {STORES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
            <button className="btn">Add admin</button>
          </form>
        )}
      </section>
    </div>
  );
}

const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Automatic volume tier from paid spend in the last 12 months (src/lib/tiers.ts). */
function TierLine({ status }: { status: TierStatus }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className={`badge ${status.tier ? "bg-accent/10 text-accent" : "bg-panel text-muted"}`}>
        {status.tier ? `${status.tier.name} · ${status.tier.percentOff}% off` : "No tier"}
      </span>
      <span className="text-xs text-muted">
        {usd0(status.spend)} paid, last 12 mo{status.next && ` · ${usd0(status.toNext)} to ${status.next.name}`}
      </span>
    </p>
  );
}
