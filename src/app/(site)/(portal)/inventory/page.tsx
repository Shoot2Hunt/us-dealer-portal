import { requireUser } from "@/lib/auth/session";
import { getCatalog } from "@/lib/catalog";
import Link from "next/link";
import { getAnnouncements, getPromotions, getSiteSettings } from "@/sanity/content";
import { isCurrent } from "@/lib/pricing";
import { getTierStatus } from "@/lib/tiers";
import { TierProgress } from "@/components/tier-progress";
import { InventoryTable } from "./inventory-table";

export default async function InventoryPage() {
  const user = await requireUser();
  const [items, announcements, s, tier, promos] = await Promise.all([
    getCatalog(user),
    getAnnouncements(),
    getSiteSettings(),
    user.role === "dealer" ? getTierStatus(user.id) : null,
    getPromotions(),
  ]);
  const running = promos.filter((p) => isCurrent(p.startsAt, p.endsAt));
  return (
    <div className="space-y-6">
      {running.length > 0 && (
        <Link
          href="/promotions"
          className="group flex animate-fade-up items-center gap-3 overflow-hidden rounded-lg bg-linear-to-r from-red-600 to-accent px-4 py-3 text-sm text-white shadow-md shadow-red-900/10 transition hover:shadow-lg"
        >
          <span className="icon-[lucide--badge-percent] h-6 w-6 shrink-0 animate-pulse" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <strong className="font-display">{running.length === 1 ? running[0]!.title : `${running.length} promotions running`}</strong>
            <span className="block truncate text-white/85">
              {running.map((p) => (p.percentOff ? `${p.title}: ${p.percentOff}% off` : p.title)).join(" · ")}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 font-semibold">
            See deals <span className="icon-[lucide--arrow-right] h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </span>
        </Link>
      )}
      {announcements.map((a) => (
        <div key={a._id} className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <p className="font-medium">{a.title}</p>
          {a.body && <p className="mt-0.5 text-muted">{a.body}</p>}
        </div>
      ))}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        {s.welcomeMessage && <p className="mt-1 text-sm text-muted">{s.welcomeMessage}</p>}
      </div>
      {tier && <TierProgress status={tier} />}
      <InventoryTable initial={{ items, at: new Date().toISOString() }} />
    </div>
  );
}
