import { TIER_WINDOW_DAYS, TIERS, type TierStatus } from "@/lib/tiers";

const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** The dealer's volume tier, spend so far, and how far to the next tier. */
export function TierProgress({ status }: { status: TierStatus }) {
  const { spend, tier, next, toNext } = status;
  const top = TIERS[TIERS.length - 1];
  // Progress toward the next tier, measured from the current tier's threshold.
  const from = tier?.minSpend ?? 0;
  const pct = next ? Math.min(100, Math.round(((spend - from) / (next.minSpend - from)) * 100)) : 100;

  return (
    <div className="card space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your dealer tier</p>
          <p className="text-lg font-semibold">
            {tier ? `${tier.name} · ${tier.percentOff}% off retail` : "Standard dealer pricing"}
          </p>
        </div>
        <p className="text-muted">
          {usd0(spend)} paid in the last {TIER_WINDOW_DAYS === 365 ? "12 months" : `${TIER_WINDOW_DAYS} days`}
        </p>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-panel" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>

      <p className="text-muted">
        {next
          ? `Spend ${usd0(toNext)} more to reach ${next.name} (${next.percentOff}% off retail).`
          : `You're at our top tier, ${top.name}. Thank you!`}{" "}
        You always pay the lower of your tier price and the regular dealer price.
      </p>

      <ol className="grid grid-cols-3 gap-2 text-center text-xs">
        {TIERS.map((t) => {
          const reached = spend >= t.minSpend;
          return (
            <li key={t.level} className={`rounded-md border px-2 py-1.5 ${tier?.level === t.level ? "border-accent bg-accent/5" : "border-line"} ${reached ? "" : "text-muted"}`}>
              <span className="font-semibold">{t.name}</span> · {t.percentOff}% off
              <br />
              {usd0(t.minSpend)}+
            </li>
          );
        })}
      </ol>
    </div>
  );
}
