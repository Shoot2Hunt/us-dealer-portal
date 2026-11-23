import Link from "next/link";
import { getBrands, getSiteSettings } from "@/sanity/content";
import { getStore, isStoreKey, STORES } from "@/lib/woo/stores";
import { LEGAL_PAGES } from "@/lib/legal";

/**
 * Light-on-dark logos in /public/brands, made for the dark footer. They win over the
 * Sanity logo, which may be a dark version meant for white backgrounds.
 */
const FOOTER_LOGOS: Record<string, string> = {
  "unknown-suppressors": "/brands/unknown-suppressors.png",
  "salmon-river-solutions": "/brands/salmon-river-solutions.png",
  shoot2hunt: "/brands/shoot2hunt.webp",
};

/** Brand site: the URL set in Sanity, else the store's WooCommerce URL. */
function brandWebsite(website: string | undefined, storeKey: string): string | null {
  if (website) return website;
  return isStoreKey(storeKey) ? getStore(storeKey).url || null : null;
}

const displayHost = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export async function SiteFooter() {
  const [s, brands] = await Promise.all([getSiteSettings(), getBrands()]);
  const portalName = s.portalName ?? "Dealer Portal";
  // No brands in Sanity (or Sanity unreachable): fall back to the four built-in stores.
  const sourced = brands.length ? brands : STORES.map((st) => ({ name: st.name, storeKey: st.key, active: true, logoUrl: undefined, website: undefined }));
  const sites = sourced
    .filter((b) => b.active)
    .map((b) => ({ ...b, logo: FOOTER_LOGOS[b.storeKey] ?? b.logoUrl, url: brandWebsite(b.website, b.storeKey) }));
  const year = new Date().getFullYear();
  const heading = "mb-4 font-display text-xs font-semibold uppercase tracking-widest text-accent-light";
  const link = "group inline-flex items-center gap-2 text-white/70 transition-colors hover:text-white";

  return (
    <footer className="relative mt-auto overflow-hidden border-t-2 border-accent bg-linear-to-br from-ink via-ink-soft to-[#3a2218] text-sm text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />

      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-[1.2fr_2fr_1fr]">
        {/* Portal + support */}
        <div className="space-y-4">
          <Link href="/" className="group inline-flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
            {s.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.logoUrl} alt="" className="h-9 rounded-md bg-white px-1.5 py-1" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-accent-light to-accent-dark">
                <span className="icon-[lucide--warehouse] h-4.5 w-4.5" aria-hidden="true" />
              </span>
            )}
            <span className="transition-colors group-hover:text-accent-light">{portalName}</span>
          </Link>
          <p className="max-w-xs text-white/60">Wholesale ordering for authorized dealers, across all of our brands in one place.</p>
          {(s.supportEmail || s.supportPhone) && (
            <ul className="space-y-2">
              {s.supportEmail && (
                <li>
                  <a href={`mailto:${s.supportEmail}`} className={link}>
                    <span className="icon-[lucide--mail] h-4 w-4 text-accent-light" aria-hidden="true" /> {s.supportEmail}
                  </a>
                </li>
              )}
              {s.supportPhone && (
                <li>
                  <a href={`tel:${s.supportPhone.replace(/[^\d+]/g, "")}`} className={link}>
                    <span className="icon-[lucide--phone] h-4 w-4 text-accent-light" aria-hidden="true" /> {s.supportPhone}
                  </a>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Brand sites */}
        {sites.length > 0 && (
          <div>
            <h2 className={heading}>Our brands</h2>
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {sites.map((b) => {
                const tile = (
                  <>
                    <span className="flex h-16 w-full items-center justify-center rounded-lg bg-white/5 p-3 ring-1 ring-white/10 transition duration-200 group-hover:-translate-y-1 group-hover:bg-white/10 group-hover:shadow-lg group-hover:shadow-accent/20 group-hover:ring-accent-light/40">
                      {b.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.logo} alt={b.name} loading="lazy" className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-105" />
                      ) : (
                        <span className="text-center font-display text-xs font-bold text-white">{b.name}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-white/60 transition-colors group-hover:text-white">
                      {b.url ? displayHost(b.url) : b.name}
                      {b.url && <span className="icon-[lucide--arrow-up-right] h-3 w-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden="true" />}
                    </span>
                  </>
                );
                return (
                  <li key={b.storeKey}>
                    {b.url ? (
                      <a href={b.url} target="_blank" rel="noopener noreferrer" className="group flex flex-col items-start gap-2" title={`Visit ${b.name}`}>
                        {tile}
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <div className="group flex flex-col items-start gap-2">{tile}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Policies */}
        <div>
          <h2 className={heading}>Policies</h2>
          <ul className="space-y-2.5">
            {LEGAL_PAGES.map((p) => (
              <li key={p.slug}>
                <Link href={`/legal/${p.slug}`} className={link}>
                  <span className="icon-[lucide--chevron-right] h-3.5 w-3.5 text-accent-light transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-xs text-white/50">
          <p>© {year} {portalName}. All rights reserved.</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL_PAGES.map((p) => (
              <Link key={p.slug} href={`/legal/${p.slug}`} className="transition-colors hover:text-white">{p.title}</Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
