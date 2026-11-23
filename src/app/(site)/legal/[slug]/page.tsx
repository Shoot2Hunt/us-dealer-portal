import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PortableText, type PortableTextBlock } from "next-sanity";
import { getPage, getSiteSettings } from "@/sanity/content";
import { LEGAL_PAGES, legalPage } from "@/lib/legal";
import { SiteFooter } from "@/components/site-footer";
import { PageTransition } from "@/components/page-transition";

/**
 * Public policy pages linked from the footer. Only the slugs in LEGAL_PAGES are served
 * here; every other Sanity page stays dealer-only under /p/<slug>.
 */
export async function generateMetadata({ params }: PageProps<"/legal/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return { title: legalPage(slug)?.title };
}

export default async function LegalPage({ params }: PageProps<"/legal/[slug]">) {
  const { slug } = await params;
  const meta = legalPage(slug);
  if (!meta) notFound();
  const [page, s] = await Promise.all([getPage(slug), getSiteSettings()]);

  return (
    <>
      <header className="border-b-2 border-accent bg-linear-to-r from-ink via-ink-soft to-header-end text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link href="/" className="font-display text-lg font-bold tracking-tight transition-colors hover:text-accent-light">
            {s.portalName ?? "Dealer Portal"}
          </Link>
          <Link href="/" transitionTypes={["nav-back"]} className="ml-auto inline-flex items-center gap-1.5 text-sm text-white/75 transition-colors hover:text-white">
            <span className="icon-[lucide--arrow-left] h-4 w-4" aria-hidden="true" /> Back to portal
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
        <div className="grid animate-fade-up gap-10 md:grid-cols-[14rem_1fr]">
          <nav aria-label="Policies" className="space-y-1 text-sm md:sticky md:top-6 md:self-start">
            {LEGAL_PAGES.map((p) => (
              <Link
                key={p.slug}
                href={`/legal/${p.slug}`}
                aria-current={p.slug === slug ? "page" : undefined}
                className="block rounded-md border-l-2 border-transparent px-3 py-2 text-muted transition hover:bg-panel hover:text-ink aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent-dark"
              >
                {p.title}
              </Link>
            ))}
          </nav>

          <PageTransition>
            <article className="max-w-3xl space-y-4">
              <h1 className="text-3xl font-bold tracking-tight">{page?.title ?? meta.title}</h1>
              {page?.body?.length ? (
                <div className="space-y-3 leading-relaxed [&_a]:text-accent [&_a]:underline [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6">
                  <PortableText value={page.body as PortableTextBlock[]} />
                </div>
              ) : (
                <p className="rounded-md bg-panel px-4 py-3 text-muted">
                  This policy hasn&apos;t been published yet.
                  {s.supportEmail && (
                    <>
                      {" "}Questions? Email <a href={`mailto:${s.supportEmail}`} className="text-accent underline">{s.supportEmail}</a>.
                    </>
                  )}
                </p>
              )}
            </article>
          </PageTransition>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
