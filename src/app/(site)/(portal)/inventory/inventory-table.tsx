"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, ViewTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { CatalogItem } from "@/lib/catalog";
import { flyToCart, useCart } from "@/components/cart";
import { usd } from "@/lib/money";
import {
  applyFilters, categoryLabel, countBy, DEFAULT_FILTERS, DEFAULT_PAGE_SIZE, filtersFromParams, filtersToQuery, pageList,
  SORT_OPTIONS, sortItems, STOCK_OPTIONS, VIEW_PAGE_SIZES, type Filters, type ViewMode,
} from "./filters";

type Data = { items: CatalogItem[]; at: string };
const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r)));

/** Remember grid/list for next time; the inventory page reads it on the server, so there's no flash. */
function rememberView(view: ViewMode) {
  document.cookie = `inventory_view=${view}; Path=/inventory; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

/** How many categories to list before "Show all". */
const CATEGORY_PREVIEW = 8;

/** Polls every 10 seconds, so stock changes from any of the four stores show up live. */
export function InventoryTable({ initial, savedView }: { initial: Data; savedView: ViewMode }) {
  const { data } = useSWR<Data>("/api/inventory", fetcher, { fallbackData: initial, refreshInterval: 10_000 });
  const items = useMemo(() => data?.items ?? [], [data]);

  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => {
    const params = new URLSearchParams(searchParams.toString());
    // No view in the link: use the dealer's last choice.
    if (!params.has("view") && savedView === "grid") params.set("view", "grid");
    return filtersFromParams(params);
  });
  const [showFilters, setShowFilters] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  // Keep the URL in step with the filters. Plain history API: no server round-trip.
  useEffect(() => {
    window.history.replaceState(null, "", `${window.location.pathname}${filtersToQuery(filters)}`);
  }, [filters]);

  /** Change filters. Anything other than the page number sends you back to page 1. */
  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));
  const toggle = (key: "brands" | "cats", value: string) =>
    setFilters((f) => ({ ...f, page: 1, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));

  // Typing stays snappy; the filtering catches up a frame later.
  const f = useDeferredValue(filters);

  const brandNames = useMemo(() => new Map(items.map((i) => [i.store, i.brandName])), [items]);
  const brandCounts = useMemo(() => countBy(applyFilters(items, f, "brands"), (i) => [i.store]), [items, f]);
  const catCounts = useMemo(() => countBy(applyFilters(items, f, "cats"), (i) => i.categories), [items, f]);
  const results = useMemo(() => sortItems(applyFilters(items, f), f.sort), [items, f]);
  const saleCount = useMemo(() => items.filter((i) => i.compareAtPrice !== null).length, [items]);

  const pages = Math.max(1, Math.ceil(results.length / f.size));
  const page = Math.min(f.page, pages);
  const start = (page - 1) * f.size;
  const shown = results.slice(start, start + f.size);

  const goToPage = (n: number) => {
    setFilters((x) => ({ ...x, page: n }));
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Chips for every active filter, each removable on its own.
  const chips: { label: string; clear: () => void }[] = [
    ...(filters.q.trim() ? [{ label: `"${filters.q.trim()}"`, clear: () => update({ q: "" }) }] : []),
    ...filters.brands.map((b) => ({ label: brandNames.get(b) ?? b, clear: () => toggle("brands", b) })),
    ...filters.cats.map((c) => ({ label: categoryLabel(c), clear: () => toggle("cats", c) })),
    ...(filters.stock !== "any" ? [{ label: STOCK_OPTIONS.find(([k]) => k === filters.stock)![1], clear: () => update({ stock: "any" }) }] : []),
    ...(filters.min || filters.max
      ? [{ label: `Dealer price ${filters.min ? usd(Number(filters.min)) : "$0"}–${filters.max ? usd(Number(filters.max)) : "any"}`, clear: () => update({ min: "", max: "" }) }]
      : []),
    ...(filters.orderable ? [{ label: "Orderable by me", clear: () => update({ orderable: false }) }] : []),
    ...(filters.featured ? [{ label: "Featured", clear: () => update({ featured: false }) }] : []),
    ...(filters.sale ? [{ label: "On sale", clear: () => update({ sale: false }) }] : []),
  ];
  const clearAll = () => setFilters((x) => ({ ...DEFAULT_FILTERS, sort: x.sort, view: x.view, size: x.size }));

  /** Switch grid/list: page size resets to that view's default (9 = a 3×3 grid), and it's remembered. */
  const setView = (view: ViewMode) => {
    if (view === filters.view) return;
    rememberView(view);
    update({ view, size: DEFAULT_PAGE_SIZE[view] });
  };

  return (
    <div ref={topRef} className="scroll-mt-24">
      {/* Top bar: search, sort, live status */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="input max-w-sm"
          placeholder="Search name, SKU, brand or category"
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
        />
        <button className="btn-ghost md:hidden" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filters{chips.length ? ` (${chips.length})` : ""}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Sort by</span>
          <select className="input w-auto" value={filters.sort} onChange={(e) => update({ sort: e.target.value as Filters["sort"] })}>
            {SORT_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-600" /> Live · updated {new Date(data?.at ?? initial.at).toLocaleTimeString()}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
        {/* Filter sidebar */}
        <aside className={`${showFilters ? "block" : "hidden"} space-y-5 text-sm md:block`}>
          <FilterSection title="Brand">
            {[...brandNames.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([key, name]) => (
              <CheckRow key={key} label={name} count={brandCounts.get(key) ?? 0} checked={filters.brands.includes(key)} onChange={() => toggle("brands", key)} />
            ))}
          </FilterSection>

          <CategoryFilter counts={catCounts} selected={filters.cats} onToggle={(c) => toggle("cats", c)} />

          <FilterSection title="Availability">
            <select className="input" value={filters.stock} onChange={(e) => update({ stock: e.target.value as Filters["stock"] })}>
              {STOCK_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </FilterSection>

          <FilterSection title="Dealer price">
            <div className="flex items-center gap-2">
              <input className="input" type="number" min={0} inputMode="decimal" placeholder="Min" aria-label="Minimum dealer price" value={filters.min} onChange={(e) => update({ min: e.target.value })} />
              <span className="text-muted">–</span>
              <input className="input" type="number" min={0} inputMode="decimal" placeholder="Max" aria-label="Maximum dealer price" value={filters.max} onChange={(e) => update({ max: e.target.value })} />
            </div>
          </FilterSection>

          <FilterSection title="More">
            <CheckRow label="Orderable by me" hint="In stock, priced, and no SOT restriction for your account" checked={filters.orderable} onChange={() => update({ orderable: !filters.orderable })} />
            <CheckRow label="Featured only" checked={filters.featured} onChange={() => update({ featured: !filters.featured })} />
            <CheckRow label="On sale" hint="Sale, promotion or tier prices" count={saleCount} checked={filters.sale} onChange={() => update({ sale: !filters.sale })} />
          </FilterSection>

          {chips.length > 0 && <button className="btn-ghost w-full" onClick={clearAll}>Clear all filters</button>}
        </aside>

        {/* Results */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-muted">
              {results.length ? `Showing ${(start + 1).toLocaleString()}–${(start + shown.length).toLocaleString()} of ${results.length.toLocaleString()}` : "0 results"}
              {results.length !== items.length && ` (filtered from ${items.length.toLocaleString()})`}
            </span>
            {chips.map((c) => (
              <button key={c.label} onClick={c.clear} className="badge gap-1 bg-panel text-ink hover:bg-line" title="Remove filter">
                {c.label} <span aria-hidden="true">×</span>
              </button>
            ))}
            {chips.length > 1 && <button onClick={clearAll} className="text-xs text-accent hover:underline">Clear all</button>}
            </div>
            <div className="ml-auto flex shrink-0 rounded-md border border-line bg-white p-0.5" role="group" aria-label="Layout">
              {([["grid", "icon-[lucide--layout-grid]", "Grid"], ["list", "icon-[lucide--list]", "List"]] as const).map(([v, icon, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={filters.view === v}
                  title={`${label} view`}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors ${filters.view === v ? "bg-ink text-white" : "text-muted hover:bg-panel hover:text-ink"}`}
                >
                  <span className={`${icon} h-4 w-4`} aria-hidden="true" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {filters.view === "grid" ? (
            shown.length ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((item) => (
                  <Card key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-line px-3 py-10 text-center text-sm text-muted">
                No products match these filters.{" "}
                {chips.length > 0 && <button onClick={clearAll} className="text-accent hover:underline">Clear all filters</button>}
              </p>
            )
          ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-linear-to-r from-panel to-accent-soft/60 text-left font-display text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Brand</th>
                  <th className="px-3 py-2">Stock</th>
                  <th className="px-3 py-2 text-right">Retail</th>
                  <th className="px-3 py-2 text-right">Dealer</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <Row key={item.id} item={item} />
                ))}
                {!shown.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-muted">
                      No products match these filters.{" "}
                      {chips.length > 0 && <button onClick={clearAll} className="text-accent hover:underline">Clear all filters</button>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}

          <Pagination page={page} pages={pages} size={f.size} sizes={VIEW_PAGE_SIZES[f.view]} onPage={goToPage} onSize={(size) => update({ size })} />
        </div>
      </div>
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

function CheckRow({ label, count, hint, checked, onChange }: { label: string; count?: number; hint?: string; checked: boolean; onChange: () => void }) {
  const empty = count === 0 && !checked;
  return (
    <label className={`flex cursor-pointer items-start gap-2 ${empty ? "opacity-50" : ""}`} title={hint}>
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={onChange} />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-xs text-muted">{count.toLocaleString()}</span>}
    </label>
  );
}

function CategoryFilter({ counts, selected, onToggle }: { counts: Map<string, number>; selected: string[]; onToggle: (c: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const [find, setFind] = useState("");
  // Selected categories stay listed even when other filters leave them at 0.
  const all = useMemo(() => {
    const keys = new Set([...counts.keys(), ...selected]);
    return [...keys].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
  }, [counts, selected]);
  if (!all.length) return null;

  const needle = find.trim().toLowerCase();
  const matching = needle ? all.filter((c) => categoryLabel(c).toLowerCase().includes(needle)) : all;
  const visible = showAll || needle ? matching : matching.slice(0, CATEGORY_PREVIEW);

  return (
    <FilterSection title="Category">
      {all.length > CATEGORY_PREVIEW && (
        <input className="input py-1 text-xs" placeholder="Find a category" value={find} onChange={(e) => setFind(e.target.value)} />
      )}
      <div className={showAll ? "max-h-72 space-y-1.5 overflow-y-auto pr-1" : "space-y-1.5"}>
        {visible.map((c) => (
          <CheckRow key={c} label={categoryLabel(c)} count={counts.get(c) ?? 0} checked={selected.includes(c)} onChange={() => onToggle(c)} />
        ))}
        {needle && !matching.length && <p className="text-xs text-muted">No categories match.</p>}
      </div>
      {!needle && all.length > CATEGORY_PREVIEW && (
        <button className="text-xs text-accent hover:underline" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show fewer" : `Show all ${all.length}`}
        </button>
      )}
    </FilterSection>
  );
}

function Pagination({ page, pages, size, sizes, onPage, onSize }: { page: number; pages: number; size: number; sizes: readonly number[]; onPage: (n: number) => void; onSize: (n: number) => void }) {
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pagination">
      <label className="flex items-center gap-2 text-muted">
        Per page
        <select className="input w-auto py-1" value={size} onChange={(e) => onSize(Number(e.target.value))}>
          {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
          {pageList(page, pages).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="px-1 text-muted">…</span>
            ) : (
              <button
                key={n}
                onClick={() => onPage(n)}
                aria-current={n === page ? "page" : undefined}
                className={n === page ? "btn px-3 py-1.5" : "btn-ghost"}
              >
                {n}
              </button>
            ),
          )}
          <button className="btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
        </div>
      )}
    </nav>
  );
}

function Row({ item }: { item: CatalogItem }) {
  const orderable = item.inStock && !item.restriction && item.dealerPrice !== null;
  const href = `/inventory/${item.store}/${item.productId}${item.variationId ? `?v=${item.variationId}` : ""}`;
  const router = useRouter();

  return (
    <tr
      // The whole row opens the product, except clicks on its own controls (qty, Add, links).
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, label, textarea")) return;
        router.push(href);
      }}
      className="cursor-pointer border-t border-line align-middle transition-colors duration-150 hover:bg-accent-soft/40"
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-3">
          <Link href={href} transitionTypes={["nav-forward"]} tabIndex={-1} aria-hidden="true" className="shrink-0">
            {item.imageUrl ? (
              // Same name as the product page's main photo, so it morphs between the two.
              <ViewTransition name={`product-img-${item.id}`} share="morph" default="none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageUrl} alt="" className="h-10 w-10 rounded relative object-cover ring-1 ring-line transition-transform duration-200 hover:z-10 hover:scale-150 hover:shadow-lg" />
              </ViewTransition>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded bg-panel text-muted/50"><span className="icon-[lucide--image] h-5 w-5" aria-hidden="true" /></div>
            )}
          </Link>
          <div>
            <p className="font-medium">
              {item.featured && <span className="badge mr-1 bg-accent/10 text-accent">Featured</span>}
              <Link
                href={href}
                transitionTypes={["nav-forward"]}
                className="group/link inline-flex items-center gap-1 decoration-accent/40 underline-offset-2 transition-colors hover:text-accent hover:underline"
              >
                {item.name}
                <span className="icon-[lucide--chevron-right] h-3.5 w-3.5 shrink-0 -translate-x-1 text-accent opacity-0 transition duration-150 group-hover/link:translate-x-0 group-hover/link:opacity-100" aria-hidden="true" />
              </Link>
            </p>
            <p className="text-xs text-muted">
              {item.sku ?? "No SKU"}
              {item.dealerNote && ` · ${item.dealerNote}`}
              {item.restriction && <span className="text-red-700"> · {item.restriction}</span>}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-muted">
        <span className="inline-flex items-center gap-1.5">
          {item.brandColor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.brandColor }} aria-hidden="true" />}
          {item.brandName}
        </span>
      </td>
      <td className="px-3 py-2">
        {!item.inStock ? (
          <span className="badge bg-red-50 text-red-700">Out of stock</span>
        ) : item.stockStatus === "onbackorder" ? (
          <span className="badge bg-amber-50 text-amber-800">Backorder</span>
        ) : (
          <span className="badge bg-green-50 text-green-800">{item.stockQuantity ?? "In stock"}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-muted">{item.retailPrice !== null ? usd(item.retailPrice) : "—"}</td>
      <td className="px-3 py-2 text-right font-medium">
        {item.compareAtPrice !== null && item.dealerPrice !== null ? (
          <>
            <span className="text-red-700">{usd(item.dealerPrice)}</span>
            <span className="block text-[11px] font-normal text-muted line-through">{usd(item.compareAtPrice)}</span>
            {item.priceReason && (
              <span
                className={`mt-0.5 inline-block max-w-32 truncate rounded px-1.5 text-[10px] font-semibold uppercase tracking-wide ${item.priceReason.kind === "tier" ? "bg-accent/10 text-accent" : "bg-red-600 text-white"}`}
                title={item.priceReason.label}
              >
                {item.priceReason.kind === "tier" ? item.priceReason.label : `${item.priceReason.label} −${Math.round((1 - item.dealerPrice / item.compareAtPrice) * 100)}%`}
              </span>
            )}
          </>
        ) : item.dealerPrice !== null ? (
          usd(item.dealerPrice)
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <ViewDetails href={href} compact />
          {orderable && <AddToCart item={item} />}
        </div>
      </td>
    </tr>
  );
}

/** Quantity + Add to cart, shared by the list rows and the grid cards. */
function AddToCart({ item, className = "justify-end" }: { item: CatalogItem; className?: string }) {
  const cart = useCart();
  const [qty, setQty] = useState(item.minQuantity);
  const [added, setAdded] = useState(false);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="number"
        min={item.minQuantity}
        max={item.stockQuantity ?? undefined}
        value={qty}
        onChange={(e) => setQty(Math.max(item.minQuantity, Number(e.target.value) || item.minQuantity))}
        className="input w-20"
      />
      <button
        className={`btn-ghost min-w-22 ${added ? "border-green-600 bg-green-600 text-white hover:border-green-600 hover:bg-green-600" : "hover:border-accent hover:bg-accent hover:text-white"}`}
        onClick={(e) => {
          cart.add(
            { id: item.id, name: item.name, sku: item.sku, brandName: item.brandName, store: item.store, unitPrice: item.dealerPrice!, minQuantity: item.minQuantity },
            qty,
          );
          setAdded(true);
          setTimeout(() => setAdded(false), 1500);
          void flyToCart(e.currentTarget).then(cart.bump);
        }}
      >
        {added ? (
          <span key="added" className="inline-flex animate-pop-in items-center gap-1.5">
            <span className="icon-[lucide--check] h-4 w-4" aria-hidden="true" /> Added
          </span>
        ) : (
          <span key="add" className="inline-flex items-center gap-1.5">
            <span className="icon-[lucide--shopping-cart] h-4 w-4" aria-hidden="true" /> Add
          </span>
        )}
      </button>
    </div>
  );
}

/** One product in the grid view: big photo, name and dealer price, the regular price crossed out when on sale. */
function Card({ item }: { item: CatalogItem }) {
  const orderable = item.inStock && !item.restriction && item.dealerPrice !== null;
  const href = `/inventory/${item.store}/${item.productId}${item.variationId ? `?v=${item.variationId}` : ""}`;
  const onSale = item.compareAtPrice !== null && item.dealerPrice !== null;
  const tier = item.priceReason?.kind === "tier";
  const saleLabel = !onSale
    ? null
    : tier
      ? item.priceReason!.label
      : `Sale −${Math.round((1 - item.dealerPrice! / item.compareAtPrice!) * 100)}%`;

  return (
    <article className="group flex animate-fade-up flex-col">
      <Link href={href} transitionTypes={["nav-forward"]} className="relative block aspect-square overflow-hidden rounded-lg bg-panel ring-1 ring-line">
        {item.imageUrl ? (
          // Same name as the product page's main photo, so it morphs between the two.
          <ViewTransition name={`product-img-${item.id}`} share="morph" default="none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt={item.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          </ViewTransition>
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted/40">
            <span className="icon-[lucide--image] h-12 w-12" aria-hidden="true" />
          </span>
        )}
        <span className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {saleLabel && (
            <span className={`max-w-40 truncate rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide shadow-sm ${tier ? "bg-accent text-white" : "bg-red-600 text-white"}`} title={item.priceReason?.label}>
              {saleLabel}
            </span>
          )}
          {item.featured && <span className="rounded bg-white/90 px-2 py-0.5 text-xs font-semibold text-accent shadow-sm">Featured</span>}
        </span>
        {!item.inStock && (
          <span className="absolute inset-x-0 bottom-0 bg-ink/75 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-white">Out of stock</span>
        )}
      </Link>

      <div className="mt-3 flex items-start justify-between gap-3">
        <Link href={href} transitionTypes={["nav-forward"]} className="min-w-0 font-medium leading-snug transition-colors hover:text-accent">
          <span className="line-clamp-2">{item.name}</span>
        </Link>
        <span className={`shrink-0 text-lg font-semibold ${onSale ? "text-red-700" : ""}`}>{item.dealerPrice !== null ? usd(item.dealerPrice) : "—"}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-3 text-sm text-muted">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {item.brandColor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.brandColor }} aria-hidden="true" />}
          <span className="truncate">
            {item.brandName}
            {item.inStock && (
              <span className={item.stockStatus === "onbackorder" ? "text-amber-700" : "text-green-700"}>
                {" · "}
                {item.stockStatus === "onbackorder" ? "Backorder" : item.stockQuantity !== null ? `${item.stockQuantity} in stock` : "In stock"}
              </span>
            )}
          </span>
        </span>
        {onSale ? (
          <span className="shrink-0 line-through">{usd(item.compareAtPrice!)}</span>
        ) : item.retailPrice !== null ? (
          <span className="shrink-0 text-xs">Retail {usd(item.retailPrice)}</span>
        ) : null}
      </div>
      {item.restriction && <p className="mt-1 text-xs text-red-700">{item.restriction}</p>}
      <div className="mt-auto space-y-2 pt-3">
        {orderable && <AddToCart item={item} className="[&>button]:flex-1" />}
        <ViewDetails href={href} />
      </div>
    </article>
  );
}

/** Opens the product page. Compact = icon + "Details" for the list's action column. */
function ViewDetails({ href, compact = false }: { href: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      transitionTypes={["nav-forward"]}
      className={`btn-ghost group/details inline-flex items-center justify-center gap-1.5 whitespace-nowrap hover:border-accent hover:text-accent ${compact ? "" : "w-full"}`}
      title="View details"
    >
      <span className="icon-[lucide--eye] h-4 w-4" aria-hidden="true" />
      {compact ? (
        <>
          <span className="hidden lg:inline">Details</span>
          <span className="sr-only lg:hidden">View details</span>
        </>
      ) : (
        <>
          View details
          <span className="icon-[lucide--arrow-right] h-4 w-4 transition-transform group-hover/details:translate-x-0.5" aria-hidden="true" />
        </>
      )}
    </Link>
  );
}
