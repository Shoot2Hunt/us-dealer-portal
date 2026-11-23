"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header link that marks itself current (accent underline) on its section's pages. */
export function NavLink({ href, className = "nav-link", children }: { href: string; className?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={className} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
