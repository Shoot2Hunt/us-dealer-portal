import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const links = [
    ["/admin", "Access requests"],
    ["/admin/dealers", "Dealers"],
    ["/admin/orders", "Orders"],
    ...(admin.role === "super_admin" ? [["/admin/sync", "Store sync"]] : []),
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3 text-sm">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="rounded px-3 py-1.5 hover:bg-panel">{label}</Link>
        ))}
        <a href="/studio" className="ml-auto btn-ghost" target="_blank">Edit content in Sanity Studio ↗</a>
      </div>
      {children}
    </div>
  );
}
