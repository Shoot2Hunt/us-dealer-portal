import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getSiteSettings } from "@/sanity/content";
import { SiteFooter } from "@/components/site-footer";
import { ContactForm } from "./form";
import { formStamp } from "./stamp";

export const metadata = { title: "Contact us" };

/** Public contact form; signed-in dealers get their details filled in. Messages land in Studio → Inbox. */
export default async function ContactPage() {
  const [user, s, stamp] = await Promise.all([getCurrentUser(), getSiteSettings(), formStamp()]);
  return (
    <>
      <header className="border-b-2 border-accent bg-linear-to-r from-ink via-ink-soft to-header-end text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link href="/" className="font-display text-lg font-bold tracking-tight transition-colors hover:text-accent-light">
            {s.portalName ?? "Dealer Portal"}
          </Link>
          <Link href={user ? "/inventory" : "/login"} transitionTypes={["nav-back"]} className="ml-auto inline-flex items-center gap-1.5 text-sm text-white/75 transition-colors hover:text-white">
            <span className="icon-[lucide--arrow-left] h-4 w-4" aria-hidden="true" /> {user ? "Back to portal" : "Dealer sign in"}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12">
        <div className="grid animate-fade-up gap-10 md:grid-cols-[1fr_18rem]">
          <section className="card shadow-sm">
            <h1 className="text-3xl font-bold">Contact us</h1>
            <p className="mb-6 mt-2 text-sm text-muted">Questions about becoming a dealer, pricing or an order? Send us a message.</p>
            <ContactForm
              stamp={stamp}
              prefill={user ? { name: user.name, email: user.email, company: user.company ?? undefined, phone: user.phone ?? undefined } : {}}
            />
          </section>

          {(s.supportEmail || s.supportPhone) && (
            <aside className="space-y-4 text-sm">
              <h2 className="font-display text-xs font-semibold uppercase tracking-widest text-muted">Other ways to reach us</h2>
              {s.supportEmail && (
                <a href={`mailto:${s.supportEmail}`} className="card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <span className="icon-[lucide--mail] h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">Email</span>
                    <span className="block truncate text-muted">{s.supportEmail}</span>
                  </span>
                </a>
              )}
              {s.supportPhone && (
                <a href={`tel:${s.supportPhone.replace(/[^\d+]/g, "")}`} className="card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <span className="icon-[lucide--phone] h-5 w-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block font-medium">Phone</span>
                    <span className="block text-muted">{s.supportPhone}</span>
                  </span>
                </a>
              )}
            </aside>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
