import { requireUser } from "@/lib/auth/session";
import { getCatalog } from "@/lib/catalog";
import { getAnnouncements, getSiteSettings } from "@/sanity/content";
import { InventoryTable } from "./inventory-table";

export default async function InventoryPage() {
  const user = await requireUser();
  const [items, announcements, s] = await Promise.all([getCatalog(user), getAnnouncements(), getSiteSettings()]);
  return (
    <div className="space-y-6">
      {announcements.map((a) => (
        <div key={a._id} className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <p className="font-medium">{a.title}</p>
          {a.body && <p className="mt-0.5 text-muted">{a.body}</p>}
        </div>
      ))}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        {s.welcomeMessage && <p className="mt-1 text-sm text-muted">{s.welcomeMessage}</p>}
      </div>
      <InventoryTable initial={{ items, at: new Date().toISOString() }} />
    </div>
  );
}
