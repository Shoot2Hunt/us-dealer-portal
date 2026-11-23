import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireUser } from "@/lib/auth/session";
import { getProduct } from "@/lib/catalog";
import { sanitizeProductHtml } from "@/lib/sanitize";
import { categoryLabel } from "../../filters";
import { ProductView } from "./product-view";

/** One lookup per request, shared by the metadata and the page. */
const load = cache(async (store: string, id: string) => {
  const productId = Number(id);
  if (!Number.isSafeInteger(productId) || productId <= 0) return null;
  return getProduct(await requireUser(), store, productId);
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
        product={{ ...rest, shortDescriptionHtml: sanitizeProductHtml(shortDescription) }}
        initialVariantId={initial.id}
      />

      {(description || product.specs.length > 0) && (
        <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
          {description ? (
            <section className="card">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <span className="icon-[lucide--file-text] h-5 w-5 text-accent" aria-hidden="true" /> Description
              </h2>
              <div className="prose-content" dangerouslySetInnerHTML={{ __html: description }} />
            </section>
          ) : (
            <div />
          )}
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
      )}

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
