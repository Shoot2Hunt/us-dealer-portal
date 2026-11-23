import Link from "next/link";
import { getBrands, getFooterPages, getFooterSettings, getSiteSettings } from "@/sanity/content";
import { getStore, isStoreKey, STORES } from "@/lib/woo/stores";
import { LEGAL_PAGES } from "@/lib/legal";

/**
 * Built-in light-on-dark logos in /public/brands for the dark footer. A "Logo for dark
 * backgrounds" uploaded on the brand in Sanity takes priority over these.
 */
const FOOTER_LOGOS: Record<string, string> = {
  "unknown-suppressors": "/brands/unknown-suppressors.png",
  "salmon-river-solutions": "/brands/salmon-river-solutions.png",
  shoot2hunt: "/brands/shoot2hunt.webp",
};

/** Literal classes so Tailwind keeps the icons. */
const SOCIAL_ICON: Record<string, string> = {
  facebook: "icon-[lucide--facebook]",
  instagram: "icon-[lucide--instagram]",
  youtube: "icon-[lucide--youtube]",
  twitter: "icon-[lucide--twitter]",
  linkedin: "icon-[lucide--linkedin]",
  website: "icon-[lucide--globe]",
};

/** Brand site: the URL set in Sanity, else the store's WooCommerce URL. */
function brandWebsite(website: string | undefined, storeKey: string): string | null {
  if (website) return website;
  return isStoreKey(storeKey) ? getStore(storeKey).url || null : null;
}

const isExternal = (href: string) => /^https?:\/\//.test(href);

export async function SiteFooter() {
  const [s, brands, f, footerPages] = await Promise.all([getSiteSettings(), getBrands(), getFooterSettings(), getFooterPages()]);
  const portalName = s.portalName ?? "Dealer Portal";
  // No brands in Sanity (or Sanity unreachable): fall back to the four built-in stores.
  const sourced = brands.length
    ? brands
    : STORES.map((st) => ({ name: st.name, storeKey: st.key, active: true, logoUrl: undefined, footerLogoUrl: undefined, website: undefined }));
  const sites = f.showBrands
    ? sourced
        .filter((b) => b.active)
        .map((b) => ({ ...b, logo: b.footerLogoUrl ?? FOOTER_LOGOS[b.storeKey] ?? b.logoUrl, url: brandWebsite(b.website, b.storeKey) }))
    : [];
  const year = String(new Date().getFullYear());
  const copyright = (f.copyright ?? `© {year} ${portalName}. All rights reserved.`).replaceAll("{year}", year);

  // Policies + footer pages + contact form, then the admin's own columns.
  const infoLinks = [
    ...(f.showPolicies ? LEGAL_PAGES.map((p) => ({ label: p.title, href: `/legal/${p.slug}` })) : []),
    ...footerPages.map((p) => ({ label: p.title, href: `/p/${p.slug}` })),
    ...(f.showContact ? [{ label: "Contact us", href: "/contact" }] : []),
  ];
  const columns = [...(infoLinks.length ? [{ title: "Information", links: infoLinks }] : []), ...f.columns];

  const heading = "mb-4 font-display text-xs font-semibold uppercase tracking-widest text-accent-light";
  const link = "group inline-flex items-center gap-2 text-white/70 transition-colors hover:text-white";

  return (
    <footer className="relative mt-auto overflow-hidden border-t-2 border-accent bg-linear-to-br from-ink via-ink-soft to-header-end text-sm text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />

      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-12 lg:grid-cols-12">
        {/* Portal + support */}
        <div className={`space-y-4 ${sites.length ? "lg:col-span-4" : "lg:col-span-5"}`}>
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
          {f.tagline && <p className="max-w-xs whitespace-pre-line text-white/60">{f.tagline}</p>}
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
          {f.social.length > 0 && (
            <ul className="flex gap-2 pt-1">
              {f.social.map((x) => (
                <li key={x.url}>
                  <a
                    href={x.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={x.platform}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/70 ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:bg-accent hover:text-white hover:ring-accent"
                  >
                    <span className={`${SOCIAL_ICON[x.platform] ?? SOCIAL_ICON.website} h-4 w-4`} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Brand sites */}
        {sites.length > 0 && (
          <div className="lg:col-span-8">
            <h2 className={heading}>{f.brandsHeading}</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {sites.map((b) => {
                const tile = (
                  <span className="flex h-16 w-full items-center justify-center rounded-lg bg-white/5 p-3 ring-1 ring-white/10 transition duration-200 group-hover:-translate-y-1 group-hover:bg-white/10 group-hover:shadow-lg group-hover:shadow-accent/20 group-hover:ring-accent-light/40">
                    {b.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.logo} alt={b.name} loading="lazy" className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-105" />
                    ) : (
                      <span className="text-center font-display text-xs font-bold text-white">{b.name}</span>
                    )}
                  </span>
                );
                return (
                  <li key={b.storeKey}>
                    {b.url ? (
                      <a href={b.url} target="_blank" rel="noopener noreferrer" className="group block" title={`Visit ${b.name}`}>
                        {tile}
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <div className="group block">{tile}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Link columns */}
        {columns.length > 0 && (
          <div className={`grid gap-8 sm:grid-cols-2 lg:grid-cols-4 ${sites.length ? "lg:col-span-12" : "lg:col-span-7"}`}>
            {columns.map((c) => (
              <div key={c.title}>
                <h2 className={heading}>{c.title}</h2>
                <ul className="space-y-2.5">
                  {c.links.map((l) => (
                    <li key={`${l.href}-${l.label}`}>
                      {isExternal(l.href) || l.href.startsWith("mailto:") || l.href.startsWith("tel:") ? (
                        <a href={l.href} className={link} {...(isExternal(l.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                          <span className="icon-[lucide--chevron-right] h-3.5 w-3.5 text-accent-light transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                          {l.label}
                        </a>
                      ) : (
                        <Link href={l.href} className={link}>
                          <span className="icon-[lucide--chevron-right] h-3.5 w-3.5 text-accent-light transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-xs text-white/50">
          <p>{copyright}</p>
          {f.showPolicies && (
            <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
              {LEGAL_PAGES.map((p) => (
                <Link key={p.slug} href={`/legal/${p.slug}`} className="transition-colors hover:text-white">{p.title}</Link>
              ))}
            </nav>
          )}
        </div>
      </div>
    </footer>
  );
}
