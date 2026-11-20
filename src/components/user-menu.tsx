import Link from "next/link";
import type { User } from "@/lib/db";
import { logout } from "@/app/(site)/(auth)/actions";

/**
 * The signed-in user's name in the header. Hover (or tap/Tab to focus) opens a menu
 * with account, security and sign-out. Pure CSS, so it works before JS loads.
 */
export function UserMenu({ user, twoFactorOn }: { user: User; twoFactorOn: boolean }) {
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const item = "block px-4 py-2 hover:bg-panel focus:bg-panel focus:outline-none";
  return (
    <div className="group relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-panel focus:bg-panel focus:outline-none"
        aria-haspopup="menu"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{initials || "?"}</span>
        <span className="hidden max-w-48 truncate sm:inline">{user.company ?? user.name}</span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-muted" aria-hidden="true"><path fill="currentColor" d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" /></svg>
      </button>
      {/* pt-2 bridges the gap so the menu doesn't close as the pointer moves onto it */}
      <div className="invisible absolute right-0 top-full z-50 w-64 pt-2 opacity-0 transition-opacity duration-100 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <div role="menu" className="overflow-hidden rounded-lg border border-line bg-white text-sm shadow-lg">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <Link href="/account#profile" role="menuitem" className={item}>Profile</Link>
          <Link href="/account#password" role="menuitem" className={item}>Change password</Link>
          <Link href="/account#two-factor" role="menuitem" className={`${item} flex items-center justify-between`}>
            Two-step verification
            <span className={`badge ${twoFactorOn ? "bg-green-100 text-green-800" : "bg-panel text-muted"}`}>{twoFactorOn ? "On" : "Off"}</span>
          </Link>
          {user.role === "dealer" && <Link href="/orders" role="menuitem" className={item}>Your orders</Link>}
          <form action={logout} className="border-t border-line">
            <button role="menuitem" className={`${item} w-full text-left text-muted hover:text-ink`}>Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );
}
