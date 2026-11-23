import { getSiteSettings } from "@/sanity/content";
import { SiteFooter } from "@/components/site-footer";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const s = await getSiteSettings();
  return (
    <>
      <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-linear-to-br from-ink via-ink-soft to-[#3a2218] px-4 py-12">
        {/* Soft accent glows behind the card */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-accent/30 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-gold/15 blur-3xl" />
        <div className="relative w-full max-w-md animate-fade-up">
          <div className="mb-6 text-center">
            {s.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.logoUrl} alt={s.portalName ?? "Dealer Portal"} className="mx-auto h-16 rounded-xl bg-white px-4 py-2 shadow-lg" />
            ) : (
              <p className="flex items-center justify-center gap-2.5 font-display text-2xl font-bold tracking-tight text-white">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-accent-light to-accent-dark shadow-lg shadow-accent/30">
                  <span className="icon-[lucide--warehouse] h-5 w-5" aria-hidden="true" />
                </span>
                {s.portalName ?? "Dealer Portal"}
              </p>
            )}
          </div>
          <div className="card border-white/10 shadow-2xl shadow-black/40">{children}</div>
          {(s.supportEmail || s.supportPhone) && (
            <p className="mt-4 text-center text-xs text-white/60">
              Questions? {s.supportEmail} {s.supportPhone && `· ${s.supportPhone}`}
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
