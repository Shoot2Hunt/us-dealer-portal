import { getSiteSettings } from "@/sanity/content";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const s = await getSiteSettings();
  return (
    <main className="flex flex-1 items-center justify-center bg-panel px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          {s.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.logoUrl} alt={s.portalName ?? "Dealer Portal"} className="mx-auto h-12" />
          ) : (
            <p className="text-2xl font-semibold tracking-tight">{s.portalName ?? "Dealer Portal"}</p>
          )}
        </div>
        <div className="card shadow-sm">{children}</div>
        {(s.supportEmail || s.supportPhone) && (
          <p className="mt-4 text-center text-xs text-muted">
            Questions? {s.supportEmail} {s.supportPhone && `· ${s.supportPhone}`}
          </p>
        )}
      </div>
    </main>
  );
}
