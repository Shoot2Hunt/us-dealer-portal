"use client";

import { useMemo, useState, ViewTransition } from "react";
import type { ProductDetail, ProductVariant } from "@/lib/catalog";
import { flyToCart, useCart, usd } from "@/components/cart";

type Props = {
  product: Omit<ProductDetail, "description" | "shortDescription"> & { shortDescriptionHtml: string | null };
  initialVariantId: number;
};

/** Gallery, variant picker, dealer pricing and add-to-cart for one product. */
export function ProductView({ product, initialVariantId }: Props) {
  const { variants } = product;
  const [selectedId, setSelectedId] = useState(initialVariantId);
  const variant = variants.find((v) => v.id === selectedId) ?? variants[0]!;

  const images = useMemo(
    () => [...new Set([variant.imageUrl, ...product.images].filter((x): x is string => Boolean(x)))],
    [variant.imageUrl, product.images],
  );
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const shown = activeImage && images.includes(activeImage) ? activeImage : images[0] ?? null;

  const [qty, setQty] = useState(variant.minQuantity);

  const select = (v: ProductVariant) => {
    setSelectedId(v.id);
    setActiveImage(v.imageUrl); // jump to the variant's own photo
    setQty(v.minQuantity);
    // Keep ?v= in step so the page can be shared or reloaded on this option.
    const url = new URL(window.location.href);
    if (v.variationId) url.searchParams.set("v", String(v.variationId));
    else url.searchParams.delete("v");
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
      <Gallery images={images} shown={shown} onPick={setActiveImage} name={product.name} morphName={`product-img-${variant.id}`} />

      <div className="space-y-6">
        <div className="space-y-2">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent-dark">
            <span className="icon-[lucide--tag] h-3.5 w-3.5" aria-hidden="true" /> {product.brandName}
          </p>
          <h1 className="text-3xl font-bold leading-tight">{product.name}</h1>
          <p className="text-sm text-muted">
            SKU <span className="font-mono text-ink">{variant.sku ?? "—"}</span>
            {variants.length > 1 && <> · {variant.label}</>}
          </p>
        </div>

        <Price variant={variant} />

        {variants.length > 1 && <VariantPicker variants={variants} selected={variant} onSelect={select} />}

        <div className="flex flex-wrap items-center gap-2">
          <StockBadge variant={variant} />
          {variant.minQuantity > 1 && (
            <span className="badge bg-panel text-muted">Minimum order: {variant.minQuantity}</span>
          )}
          {variant.featured && <span className="badge bg-accent/10 text-accent">Featured</span>}
        </div>

        {variant.restriction && (
          <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <span className="icon-[lucide--shield-alert] mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {variant.restriction}
          </p>
        )}
        {variant.dealerNote && (
          <p className="flex items-start gap-2 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent-dark">
            <span className="icon-[lucide--info] mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {variant.dealerNote}
          </p>
        )}

        <AddToCart variant={variant} qty={qty} setQty={setQty} />

        {product.shortDescriptionHtml && (
          <div className="prose-content border-t border-line pt-5" dangerouslySetInnerHTML={{ __html: product.shortDescriptionHtml }} />
        )}

        {product.productUrl && (
          <a
            href={product.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-accent"
          >
            <span className="icon-[lucide--globe] h-4 w-4" aria-hidden="true" />
            View on the {product.brandName} site
            <span className="icon-[lucide--arrow-up-right] h-3.5 w-3.5 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>

      {variants.length > 1 && (
        <section className="lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <span className="icon-[lucide--layers] h-5 w-5 text-accent" aria-hidden="true" /> All options
          </h2>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-linear-to-r from-panel to-accent-soft/60 text-left font-display text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Option</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Stock</th>
                  <th className="px-3 py-2 text-right">Retail</th>
                  <th className="px-3 py-2 text-right">Dealer</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr
                    key={v.id}
                    // The whole row is clickable; the button inside makes it keyboard-reachable (its click bubbles here).
                    onClick={() => select(v)}
                    className={`cursor-pointer border-t border-line transition-colors ${v.id === variant.id ? "bg-accent-soft" : "hover:bg-accent-soft/40"}`}
                  >
                    <td className="px-3 py-2">
                      <button type="button" aria-pressed={v.id === variant.id} className="text-left font-medium hover:text-accent">
                        {v.label}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{v.sku ?? "—"}</td>
                    <td className="px-3 py-2"><StockBadge variant={v} /></td>
                    <td className="px-3 py-2 text-right text-muted">{v.retailPrice !== null ? usd(v.retailPrice) : "—"}</td>
                    <td className="px-3 py-2 text-right font-medium">{v.dealerPrice !== null ? usd(v.dealerPrice) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Gallery({ images, shown, onPick, name, morphName }: { images: string[]; shown: string | null; onPick: (src: string) => void; name: string; morphName: string }) {
  // Hover-to-zoom: the image scales up around the pointer.
  const [origin, setOrigin] = useState<string | null>(null);
  // The first photo arrives via the page-transition morph; only later switches fade in.
  const [firstShown] = useState(shown);
  return (
    <div className="space-y-3">
      <div
        className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-panel"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
        }}
        onMouseLeave={() => setOrigin(null)}
      >
        {shown ? (
          // Same name as the inventory thumbnail, so the photo morphs between the two pages.
          <ViewTransition name={morphName} share="morph" default="none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={shown}
              src={shown}
              alt={name}
              style={{ transformOrigin: origin ?? "center" }}
              className={`h-full w-full object-contain p-4 transition-transform duration-300 ${shown !== firstShown ? "animate-fade-in" : ""} ${origin ? "scale-[1.8] cursor-zoom-in" : ""}`}
            />
          </ViewTransition>
        ) : (
          <div className="flex h-full items-center justify-center text-muted/40">
            <span className="icon-[lucide--image] h-20 w-20" aria-hidden="true" />
          </div>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => onPick(src)}
              aria-label={`Show image ${i + 1}`}
              aria-current={src === shown}
              className={`h-18 w-18 shrink-0 overflow-hidden rounded-lg border-2 bg-panel transition duration-150 hover:-translate-y-0.5 ${src === shown ? "border-accent shadow-md shadow-accent/20" : "border-transparent opacity-70 hover:opacity-100"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Price({ variant }: { variant: ProductVariant }) {
  const { dealerPrice, retailPrice, tierApplied } = variant;
  const saving = dealerPrice !== null && retailPrice ? Math.round((1 - dealerPrice / retailPrice) * 100) : 0;
  return (
    <div className="rounded-xl border border-line bg-linear-to-br from-white to-accent-soft/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your dealer price</p>
      <div key={variant.id} className="mt-1 flex animate-fade-up flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-3xl font-bold text-ink">{dealerPrice !== null ? usd(dealerPrice) : "Call for pricing"}</span>
        {retailPrice !== null && dealerPrice !== null && retailPrice > dealerPrice && (
          <span className="text-sm text-muted line-through">{usd(retailPrice)} retail</span>
        )}
        {saving > 0 && <span className="badge bg-green-100 text-green-800">Save {saving}%</span>}
      </div>
      {tierApplied && (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-accent">
          <span className="icon-[lucide--award] h-3.5 w-3.5" aria-hidden="true" /> {tierApplied} pricing applied
        </p>
      )}
    </div>
  );
}

function StockBadge({ variant }: { variant: ProductVariant }) {
  if (!variant.inStock) return <span className="badge bg-red-50 text-red-700">Out of stock</span>;
  if (variant.stockStatus === "onbackorder") return <span className="badge bg-amber-50 text-amber-800">Backorder</span>;
  return (
    <span className="badge gap-1 bg-green-50 text-green-800">
      <span className="h-1.5 w-1.5 rounded-full bg-green-600" aria-hidden="true" />
      {variant.stockQuantity !== null ? `${variant.stockQuantity.toLocaleString()} in stock` : "In stock"}
    </span>
  );
}

/**
 * One row of option buttons per attribute (Caliber, Color…). Picking an option keeps the
 * other choices when that combination exists, otherwise jumps to the closest one that does.
 * Products synced before attributes were stored fall back to one button per variant.
 */
function VariantPicker({ variants, selected, onSelect }: { variants: ProductVariant[]; selected: ProductVariant; onSelect: (v: ProductVariant) => void }) {
  const names = [...new Set(variants.flatMap((v) => v.attributes.map((a) => a.name)))];
  const pill = (active: boolean, available: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm transition duration-150 active:scale-95 ${
      active
        ? "border-accent bg-accent text-white shadow-sm shadow-accent/30"
        : available
          ? "border-line bg-white hover:border-accent hover:text-accent"
          : "border-dashed border-line bg-white text-muted line-through decoration-muted/50 hover:border-muted"
    }`;

  if (!names.length) {
    return (
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Option</legend>
        <div className="flex flex-wrap gap-2">
          {variants.map((v) => (
            <button key={v.id} type="button" onClick={() => onSelect(v)} aria-pressed={v.id === selected.id} className={pill(v.id === selected.id, v.inStock)}>
              {v.label}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  const valueOf = (v: ProductVariant, name: string) => v.attributes.find((a) => a.name === name)?.option;
  return (
    <div className="space-y-4">
      {names.map((name) => {
        const options = [...new Set(variants.map((v) => valueOf(v, name)).filter((o): o is string => Boolean(o)))];
        const current = valueOf(selected, name);
        return (
          <fieldset key={name}>
            <legend className="mb-2 text-sm">
              <span className="font-semibold">{name}:</span> <span className="text-muted">{current ?? "—"}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {options.map((option) => {
                const withOption = variants.filter((v) => valueOf(v, name) === option);
                // Same choices for every other attribute, with this one swapped.
                const exact = withOption.find((v) => names.every((n) => n === name || valueOf(v, n) === valueOf(selected, n)));
                const target = exact ?? withOption.find((v) => v.inStock) ?? withOption[0]!;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onSelect(target)}
                    aria-pressed={current === option}
                    title={exact && !exact.inStock ? "Out of stock" : undefined}
                    className={pill(current === option, (exact ?? target).inStock)}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function AddToCart({ variant, qty, setQty }: { variant: ProductVariant; qty: number; setQty: (n: number) => void }) {
  const cart = useCart();
  const [added, setAdded] = useState(false);
  const orderable = variant.inStock && !variant.restriction && variant.dealerPrice !== null;
  const min = variant.minQuantity;
  const max = variant.stockQuantity ?? undefined;
  const inCart = cart.lines.find((l) => l.id === variant.id)?.quantity ?? 0;
  const step = "flex h-11 w-11 items-center justify-center text-muted transition hover:bg-panel hover:text-ink active:scale-90 disabled:opacity-40";

  if (!orderable) {
    return (
      <button type="button" disabled className="btn w-full py-3">
        {variant.restriction ? "Not available for your account" : !variant.inStock ? "Out of stock" : "Not available to order"}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        <div className="inline-flex items-center overflow-hidden rounded-md border border-line bg-white">
          <button type="button" className={step} onClick={() => setQty(Math.max(min, qty - 1))} disabled={qty <= min} aria-label="Decrease quantity">
            <span className="icon-[lucide--minus] h-4 w-4" aria-hidden="true" />
          </button>
          <input
            type="number"
            min={min}
            max={max}
            value={qty}
            onChange={(e) => setQty(Math.max(min, Number(e.target.value) || min))}
            aria-label="Quantity"
            className="h-11 w-16 border-x border-line text-center tabular-nums outline-none [appearance:textfield] focus:bg-accent-soft/50 [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button type="button" className={step} onClick={() => setQty(max ? Math.min(max, qty + 1) : qty + 1)} disabled={max !== undefined && qty >= max} aria-label="Increase quantity">
            <span className="icon-[lucide--plus] h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className={`btn-accent flex-1 py-3 text-base ${added ? "from-green-500! to-green-700! shadow-green-600/30!" : ""}`}
          onClick={(e) => {
            cart.add(
              { id: variant.id, name: variant.name, sku: variant.sku, brandName: variant.brandName, store: variant.store, unitPrice: variant.dealerPrice!, minQuantity: variant.minQuantity },
              qty,
            );
            setAdded(true);
            setTimeout(() => setAdded(false), 1500);
            void flyToCart(e.currentTarget).then(cart.bump);
          }}
        >
          {added ? (
            <span key="added" className="inline-flex animate-pop-in items-center gap-2">
              <span className="icon-[lucide--check] h-5 w-5" aria-hidden="true" /> Added to cart
            </span>
          ) : (
            <span key="add" className="inline-flex items-center gap-2">
              <span className="icon-[lucide--shopping-cart] h-5 w-5" aria-hidden="true" /> Add to cart · {usd(variant.dealerPrice! * qty)}
            </span>
          )}
        </button>
      </div>
      {inCart > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <span className="icon-[lucide--shopping-bag] h-3.5 w-3.5 text-accent" aria-hidden="true" />
          {inCart.toLocaleString()} already in your cart ·{" "}
          <button type="button" onClick={cart.open} className="text-accent hover:underline">View cart</button>
        </p>
      )}
    </div>
  );
}
