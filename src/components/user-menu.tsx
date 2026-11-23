import Link from "next/link";
import type { User } from "@/lib/db";
import { logout } from "@/app/(site)/(auth)/actions";

/**
 * The signed-in user's name in the header. Hover (or tap/Tab to focus) opens a menu
 * with account, security and sign-out. Pure CSS, so it works before JS loads.
 */
export function UserMenu({ user, twoFactorOn }: { user: User; twoFactorOn: boolean }) {
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const item = "flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-accent-soft hover:text-accent-dark focus:bg-accent-soft focus:outline-none";
  const icon = "h-4 w-4 shrink-0 opacity-70";
  return (
    <div className="group relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-white transition hover:bg-white/10 focus:bg-white/10 focus:outline-none"
        aria-haspopup="menu"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-br from-accent-light to-accent-dark font-display text-xs font-bold text-white ring-2 ring-white/20">{initials || "?"}</span>
        <span className="hidden max-w-48 truncate sm:inline">{user.company ?? user.name}</span>
        <span className="icon-[lucide--chevron-down] h-4 w-4 text-white/60 transition-transform duration-200 group-focus-within:rotate-180 group-hover:rotate-180" aria-hidden="true" />
      </button>
      {/* pt-2 bridges the gap so the menu doesn't close as the pointer moves onto it */}
      <div className="invisible absolute right-0 top-full z-50 w-64 origin-top-right translate-y-1 scale-95 pt-2 text-ink opacity-0 transition duration-150 ease-out group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100">
        <div role="menu" className="overflow-hidden rounded-lg border border-line bg-white text-sm shadow-lg">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <Link href="/account#profile" role="menuitem" className={item}><span className={`icon-[lucide--user-round] ${icon}`} aria-hidden="true" />Profile</Link>
          <Link href="/account#password" role="menuitem" className={item}><span className={`icon-[lucide--key-round] ${icon}`} aria-hidden="true" />Change password</Link>
          <Link href="/account#two-factor" role="menuitem" className={item}>
            <span className={`icon-[lucide--shield-check] ${icon}`} aria-hidden="true" />
            Two-step verification
            <span className={`badge ml-auto ${twoFactorOn ? "bg-green-100 text-green-800" : "bg-panel text-muted"}`}>{twoFactorOn ? "On" : "Off"}</span>
          </Link>
          {user.role === "dealer" && <Link href="/orders" role="menuitem" className={item}><span className={`icon-[lucide--receipt-text] ${icon}`} aria-hidden="true" />Your orders</Link>}
          <form action={logout} className="border-t border-line">
            <button role="menuitem" className={`${item} w-full text-left text-muted hover:bg-red-50! hover:text-red-700!`}><span className={`icon-[lucide--log-out] ${icon}`} aria-hidden="true" />Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );
}
