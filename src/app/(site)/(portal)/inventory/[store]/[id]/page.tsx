import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireUser } from "@/lib/auth/session";
import { getProduct } from "@/lib/catalog";
import { refreshProduct } from "@/lib/woo/sync";
import { isStoreKey } from "@/lib/woo/stores";
import { descriptionExcerpt, sanitizeProductHtml } from "@/lib/sanitize";
import { categoryLabel } from "../../filters";
import { ProductView } from "./product-view";
import { PluginEmbeds } from "@/components/plugin-slots";

/** One lookup per request, shared by the metadata and the page. */
/** Don't re-fetch the same product from its store more often than this. */
const REFRESH_COOLDOWN_MS = 10 * 60_000;

/**
 * One lookup per request, shared by the metadata and the page. Products synced before the
 * detail fields existed have no description or photos: fetch that one product fresh from
 * its WooCommerce store first (bounded wait), so its page is complete without a full sync.
 */
const load = cache(async (store: string, id: string) => {
  const productId = Number(id);
  if (!Number.isSafeInteger(productId) || productId <= 0) return null;
  const user = await requireUser();
  const product = await getProduct(user, store, productId);
  const missingDetails = product && !product.description && !product.shortDescription && product.images.length === 0;
  if (!missingDetails || !isStoreKey(store) || Date.now() - product.syncedAt.getTime() < REFRESH_COOLDOWN_MS) return product;
  try {
    await Promise.race([refreshProduct(store, productId), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))]);
    return (await getProduct(user, store, productId)) ?? product;
  } catch (err) {
    console.error("[product page] refresh failed", store, productId, err);
    return product;
  }
});

export async function generateMetadata({ params }: PageProps<"/inventory/[store]/[id]">): Promise<Metadata> {
  const { store, id } = await params;
  const product = await load(store, id);
  return { title: product ? `${product.name} · ${product.brandName}` : "Product not found" };
}

export default async function ProductPage({ params, searchParams }: PageProps<"/inventory/[store]/[id]">) {
  const [{ store, id }, sp] = await Promise.all([params, searchParams]);
  const product = await load(store, id);
  if (!product) notFound();

  const v = Number(Array.isArray(sp.v) ? sp.v[0] : sp.v);
  const initial = product.variants.find((x) => x.variationId === v) ?? product.variants.find((x) => x.inStock) ?? product.variants[0]!;
  const description = sanitizeProductHtml(product.description);
  const { description: _raw, shortDescription, ...rest } = product;
  void _raw; // raw HTML stays on the server

  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/inventory" transitionTypes={["nav-back"]} className="inline-flex items-center gap-1 transition-colors hover:text-accent">
          <span className="icon-[lucide--boxes] h-4 w-4" aria-hidden="true" /> Inventory
        </Link>
        <span className="icon-[lucide--chevron-right] h-3.5 w-3.5 opacity-50" aria-hidden="true" />
        <Link href={`/inventory?brand=${encodeURIComponent(product.store)}`} transitionTypes={["nav-back"]} className="transition-colors hover:text-accent">
          {product.brandName}
        </Link>
        <span className="icon-[lucide--chevron-right] h-3.5 w-3.5 opacity-50" aria-hidden="true" />
        <span className="truncate text-ink" aria-current="page">{product.name}</span>
      </nav>

      <ProductView
        product={{ ...rest, shortDescriptionHtml: sanitizeProductHtml(shortDescription), hasDescription: Boolean(description), descriptionExcerpt: descriptionExcerpt(description) }}
        initialVariantId={initial.id}
      />

      <div className={`grid gap-8 ${product.specs.length > 0 ? "lg:grid-cols-[1fr_22rem]" : ""}`}>
          {/* Prominent on purpose: dealers were scrolling past a plain card. */}
          <section id="description" className="scroll-mt-24 overflow-hidden rounded-xl border border-line bg-white shadow-md shadow-ink/5">
            <div className="flex items-center justify-between gap-3 border-b-2 border-accent bg-linear-to-r from-ink via-ink-soft to-header-end px-6 py-4 text-white">
              <h2 className="flex items-center gap-2.5 font-display text-xl font-bold tracking-tight">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
                  <span className="icon-[lucide--file-text] h-4.5 w-4.5" aria-hidden="true" />
                </span>
                Product description
              </h2>
              <span className="hidden text-sm text-white/70 sm:block">From {product.brandName}</span>
            </div>
            <div className="px-6 py-6">
            {description ? (
              <div className="prose-content text-[15px] leading-relaxed" dangerouslySetInnerHTML={{ __html: description }} />
            ) : (
              <p className="text-sm text-muted">
                {product.brandName} hasn&apos;t added a description for this product yet.
                {product.productUrl && (
                  <>
                    {" "}
                    <a href={product.productUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      See it on their website
                    </a>
                    .
                  </>
                )}
              </p>
            )}
            </div>
          </section>
          {product.specs.length > 0 && (
            <section className="card h-fit">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <span className="icon-[lucide--list-checks] h-5 w-5 text-accent" aria-hidden="true" /> Specifications
              </h2>
              <dl className="divide-y divide-line text-sm">
                {product.specs.map((s) => (
                  <div key={s.name} className="flex gap-4 py-2">
                    <dt className="w-2/5 shrink-0 text-muted">{s.name}</dt>
                    <dd className="font-medium">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
      </div>

      <PluginEmbeds slot="product" user={await requireUser()} />

      {product.categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Categories:</span>
          {product.categories.map((c) => (
            <Link
              key={c}
              href={`/inventory?cat=${encodeURIComponent(c)}`}
              transitionTypes={["nav-back"]}
              className="badge bg-panel text-ink transition-colors hover:bg-accent-soft hover:text-accent-dark"
            >
              {categoryLabel(c)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
