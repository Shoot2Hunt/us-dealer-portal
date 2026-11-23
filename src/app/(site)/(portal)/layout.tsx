import Link from "next/link";
import { isAdmin, requireSignedIn, twoFactorEnabled } from "@/lib/auth/session";
import { getHeaderSettings, getNavPages, getPluginSettings, getSiteSettings, type NavLink as NavItem } from "@/sanity/content";
import { CartProvider } from "@/components/cart";
import { CartDrawer } from "@/components/cart-drawer";
import { CartLink } from "@/components/cart-link";
import { NavLink } from "@/components/nav-link";
import { PageTransition } from "@/components/page-transition";
import { SiteFooter } from "@/components/site-footer";
import { UserMenu } from "@/components/user-menu";

/** Header link icons chosen in Sanity → Appearance → Header. Literal classes so Tailwind keeps them. */
const NAV_ICON_CLASS: Record<string, string> = {
  boxes: "icon-[lucide--boxes]",
  receipt: "icon-[lucide--receipt-text]",
  file: "icon-[lucide--file-text]",
  help: "icon-[lucide--circle-help]",
  phone: "icon-[lucide--phone]",
  truck: "icon-[lucide--truck]",
  tag: "icon-[lucide--tag]",
  star: "icon-[lucide--star]",
  info: "icon-[lucide--info]",
  mail: "icon-[lucide--mail]",
};

const DEFAULT_LINKS: NavItem[] = [
  { label: "Inventory", href: "/inventory", icon: "boxes" },
  { label: "Orders", href: "/orders", icon: "receipt" },
];

function HeaderLink({ link }: { link: NavItem }) {
  const icon = link.icon && NAV_ICON_CLASS[link.icon];
  const content = (
    <>
      {icon && <span className={`${icon} h-4 w-4`} aria-hidden="true" />} {link.label}
    </>
  );
  if (/^https?:\/\//.test(link.href)) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className="nav-link">
        {content}
        <span className="icon-[lucide--arrow-up-right] h-3 w-3 opacity-60" aria-hidden="true" />
      </a>
    );
  }
  return <NavLink href={link.href}>{content}</NavLink>;
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSignedIn();
  const [s, pages, header, plugins] = await Promise.all([getSiteSettings(), getNavPages(), getHeaderSettings(), getPluginSettings()]);
  const admin = isAdmin(user);
  const maintenance = plugins.maintenance;
  const blocked = maintenance.enabled && !admin;
  const links = [
    ...(header.links.length ? header.links : DEFAULT_LINKS),
    ...(header.showPages ? pages.map((p) => ({ label: p.title, href: `/p/${p.slug}` })) : []),
    ...(header.showContact ? [{ label: "Contact", href: "/contact", icon: "mail" }] : []),
  ];

  return (
    <CartProvider userId={user.id}>
      <header
        style={{ viewTransitionName: "site-header" }}
        className={`${header.sticky ? "sticky top-0" : "relative"} z-40 border-b-2 border-accent bg-linear-to-r from-ink via-ink-soft to-header-end text-white shadow-md shadow-ink/10`}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
          <Link href="/" className="group flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
            {header.showLogo &&
              (s.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.logoUrl} alt="" className="h-9 rounded-md bg-white px-1.5 py-1 transition-transform duration-300 group-hover:scale-105" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-accent-light to-accent-dark shadow-sm transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                  <span className="icon-[lucide--warehouse] h-4.5 w-4.5" aria-hidden="true" />
                </span>
              ))}
            <span className="transition-colors group-hover:text-accent-light">{s.portalName ?? "Dealer Portal"}</span>
          </Link>
          <nav className="flex flex-1 flex-wrap items-center gap-5 text-sm">
            {!blocked && links.map((l) => <HeaderLink key={`${l.href}-${l.label}`} link={l} />)}
            {admin && (
              <NavLink href="/admin" className="nav-link font-medium text-gold! hover:text-gold!">
                <span className="icon-[lucide--shield-check] h-4 w-4" aria-hidden="true" /> Admin
              </NavLink>
            )}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            {!blocked && <CartLink />}
            <UserMenu user={user} twoFactorOn={twoFactorEnabled(user)} />
          </div>
        </div>
      </header>

      {maintenance.enabled && admin && (
        <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          <span className="icon-[lucide--wrench] h-4 w-4" aria-hidden="true" />
          Maintenance mode is on: dealers see a maintenance notice. Turn it off in Studio → Plugins.
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        {blocked ? <MaintenanceNotice {...maintenance} /> : <PageTransition>{children}</PageTransition>}
      </main>
      <SiteFooter />
      {!blocked && <CartDrawer />}
    </CartProvider>
  );
}

function MaintenanceNotice({ title, message, until }: { title: string; message: string; until?: string }) {
  const back = until ? new Date(until) : null;
  return (
    <div className="mx-auto flex max-w-lg animate-fade-up flex-col items-center py-16 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-soft text-accent">
        <span className="icon-[lucide--wrench] h-10 w-10 animate-pulse" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-3xl font-bold">{title}</h1>
      <p className="mt-3 whitespace-pre-line text-muted">{message}</p>
      {back && !Number.isNaN(back.getTime()) && (
        <p className="mt-4 rounded-full bg-panel px-4 py-1.5 text-sm">
          Expected back {back.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
        </p>
      )}
    </div>
  );
}
