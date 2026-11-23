import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getPromotions, type Promotion } from "@/sanity/content";
import { isCurrent } from "@/lib/pricing";
import { categoryLabel } from "../inventory/filters";
import { CopyCode } from "./copy-code";

export const metadata = { title: "Promotions" };

const BRAND_NAMES: Record<string, string> = {
  "unknown-suppressors": "Unknown Suppressors",
  "unknown-munitions": "Unknown Munitions",
  "salmon-river-solutions": "Salmon River Solutions",
  shoot2hunt: "Shoot2Hunt",
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "Ends in 3 days", "Starts Dec 1, 2026"… Worked out per request, outside render. */
function timing(p: Promotion): { running: boolean; label: string | null; urgent: boolean } {
  const now = Date.now();
  if (!isCurrent(p.startsAt, null, now)) return { running: false, label: `Starts ${fmtDate(p.startsAt!)}`, urgent: false };
  if (!p.endsAt) return { running: true, label: null, urgent: false };
  const ms = Date.parse(p.endsAt) - now;
  const days = Math.floor(ms / 864e5);
  const hours = Math.max(1, Math.ceil(ms / 36e5));
  return { running: true, label: days >= 1 ? `Ends in ${days} day${days === 1 ? "" : "s"} · ${fmtDate(p.endsAt)}` : `Ends in ${hours} hour${hours === 1 ? "" : "s"}`, urgent: days < 3 };
}

/** Inventory link pre-filtered to what the promotion covers. */
function shopLink(p: Promotion) {
  const q = new URLSearchParams();
  if (p.brands.length) q.set("brand", p.brands.join(","));
  if (p.categories.length) q.set("cat", p.categories.join(","));
  if (p.percentOff > 0) q.set("sale", "1");
  const s = q.toString();
  return `/inventory${s ? `?${s}` : ""}`;
}

export default async function PromotionsPage() {
  await requireUser();
  const promos = (await getPromotions()).map((p) => ({ ...p, t: timing(p) }));
  const running = promos.filter((p) => p.t.running);
  const upcoming = promos.filter((p) => !p.t.running);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <span className="icon-[lucide--badge-percent] h-8 w-8 text-accent" aria-hidden="true" /> Promotions
        </h1>
        <p className="mt-1 text-sm text-muted">Current deals for dealers. Sale prices apply automatically; discount codes go in at checkout.</p>
      </div>

      {running.length === 0 && (
        <div className="card flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
            <span className="icon-[lucide--tag] h-8 w-8" aria-hidden="true" />
          </span>
          <p className="font-display text-lg font-semibold">No promotions running right now</p>
          <p className="text-sm text-muted">Check back soon{upcoming.length ? " — something's coming up below." : "."}</p>
        </div>
      )}

      {running.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {running.map((p, i) => (
            <PromoCard key={p.id} promo={p} timingLabel={p.t.label} urgent={p.t.urgent} index={i} />
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="icon-[lucide--calendar-clock] h-5 w-5 text-accent" aria-hidden="true" /> Coming up
          </h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((p, i) => (
              <PromoCard key={p.id} promo={p} timingLabel={p.t.label} urgent={false} index={i} upcoming />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PromoCard({ promo: p, timingLabel, urgent, index, upcoming }: { promo: Promotion; timingLabel: string | null; urgent: boolean; index: number; upcoming?: boolean }) {
  const covers = [
    ...p.brands.map((b) => BRAND_NAMES[b] ?? b),
    ...p.categories.map(categoryLabel),
    ...(p.skus.length ? [`${p.skus.length} selected item${p.skus.length === 1 ? "" : "s"}`] : []),
  ];
  return (
    <article
      style={{ animationDelay: `${Math.min(index, 6) * 70}ms` }}
      className={`group flex animate-fade-up flex-col overflow-hidden rounded-xl border border-line bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg ${upcoming ? "opacity-80" : ""}`}
    >
      <div className="relative aspect-[2.4/1] overflow-hidden bg-linear-to-br from-ink via-ink-soft to-header-end">
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${p.imageUrl}?w=1200&auto=format`} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="icon-[lucide--badge-percent] h-16 w-16 text-white/20" aria-hidden="true" />
          </div>
        )}
        {p.percentOff > 0 && (
          <span className="absolute left-4 top-4 rounded-lg bg-red-600 px-3 py-1.5 font-display text-2xl font-black text-white shadow-lg shadow-red-900/30">
            {p.percentOff}% OFF
          </span>
        )}
        {timingLabel && (
          <span className={`absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur ${urgent ? "bg-amber-400 text-ink" : "bg-black/50 text-white"}`}>
            <span className="icon-[lucide--clock] h-3.5 w-3.5" aria-hidden="true" /> {timingLabel}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="text-xl font-bold">{p.title}</h3>
        {p.summary && <p className="whitespace-pre-line text-sm text-muted">{p.summary}</p>}
        {covers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {covers.map((c) => <span key={c} className="badge bg-panel text-ink">{c}</span>)}
          </div>
        )}
        {p.code && (
          <div className="rounded-lg bg-panel p-3 text-sm">
            <p className="mb-2 text-muted">
              Use code at checkout{p.code.description ? `: ${p.code.description}` : ` for ${p.code.type === "amount" ? `$${p.code.value} off` : `${p.code.value}% off`}`}
            </p>
            <CopyCode code={p.code.code} />
          </div>
        )}
        {!upcoming && (
          <Link href={shopLink(p)} className="btn-accent mt-auto self-start">
            Shop the {p.percentOff > 0 ? "sale" : "promotion"} <span className="icon-[lucide--arrow-right] h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
    </article>
  );
}
