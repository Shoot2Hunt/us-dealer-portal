import Link from "next/link";
import { isAdmin, requireUser, twoFactorEnabled } from "@/lib/auth/session";
import { getNavPages, getSiteSettings } from "@/sanity/content";
import { CartProvider } from "@/components/cart";
import { CartDrawer } from "@/components/cart-drawer";
import { CartLink } from "@/components/cart-link";
import { NavLink } from "@/components/nav-link";
import { UserMenu } from "@/components/user-menu";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [s, pages] = await Promise.all([getSiteSettings(), getNavPages()]);
  return (
    <CartProvider userId={user.id}>
      <header className="sticky top-0 z-40 border-b-2 border-accent bg-linear-to-r from-ink via-ink-soft to-[#3a2218] text-white shadow-md shadow-ink/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
          <Link href="/" className="group flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
            {s.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.logoUrl} alt="" className="h-9 rounded-md bg-white px-1.5 py-1 transition-transform duration-300 group-hover:scale-105" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-accent-light to-accent-dark shadow-sm transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                <span className="icon-[lucide--warehouse] h-4.5 w-4.5" aria-hidden="true" />
              </span>
            )}
            <span className="transition-colors group-hover:text-accent-light">{s.portalName ?? "Dealer Portal"}</span>
          </Link>
          <nav className="flex flex-1 flex-wrap items-center gap-5 text-sm">
            <NavLink href="/inventory">
              <span className="icon-[lucide--boxes] h-4 w-4" aria-hidden="true" /> Inventory
            </NavLink>
            <NavLink href="/orders">
              <span className="icon-[lucide--receipt-text] h-4 w-4" aria-hidden="true" /> Orders
            </NavLink>
            {pages.map((p) => (
              <NavLink key={p.slug} href={`/p/${p.slug}`}>{p.title}</NavLink>
            ))}
            {isAdmin(user) && (
              <NavLink href="/admin" className="nav-link font-medium text-gold! hover:text-gold!">
                <span className="icon-[lucide--shield-check] h-4 w-4" aria-hidden="true" /> Admin
              </NavLink>
            )}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <CartLink />
            <UserMenu user={user} twoFactorOn={twoFactorEnabled(user)} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>
      <CartDrawer />
    </CartProvider>
  );
}
