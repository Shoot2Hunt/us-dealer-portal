import Link from "next/link";
import { isAdmin, requireUser } from "@/lib/auth/session";
import { getNavPages, getSiteSettings } from "@/sanity/content";
import { CartProvider } from "@/components/cart";
import { CartLink } from "@/components/cart-link";
import { logout } from "../(auth)/actions";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [s, pages] = await Promise.all([getSiteSettings(), getNavPages()]);
  return (
    <CartProvider userId={user.id}>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/inventory" className="flex items-center gap-2 font-semibold tracking-tight">
            {s.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.logoUrl} alt="" className="h-8" />
            ) : null}
            {s.portalName ?? "Dealer Portal"}
          </Link>
          <nav className="flex flex-1 flex-wrap items-center gap-4 text-sm">
            <Link href="/inventory" className="hover:text-accent">Inventory</Link>
            <Link href="/orders" className="hover:text-accent">Orders</Link>
            {pages.map((p) => (
              <Link key={p.slug} href={`/p/${p.slug}`} className="hover:text-accent">{p.title}</Link>
            ))}
            {isAdmin(user) && <Link href="/admin" className="font-medium text-accent">Admin</Link>}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{user.company ?? user.name}</span>
            <CartLink />
            <form action={logout}>
              <button className="text-muted hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>
    </CartProvider>
  );
}
