"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { CatalogItem } from "@/lib/catalog";
import { useCart, usd } from "@/components/cart";

type Data = { items: CatalogItem[]; at: string };
const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r)));

/** Polls every 10 seconds, so stock changes from any of the four stores show up live. */
export function InventoryTable({ initial }: { initial: Data }) {
  const { data } = useSWR<Data>("/api/inventory", fetcher, { fallbackData: initial, refreshInterval: 10_000 });
  const items = useMemo(() => data?.items ?? [], [data]);
  const [brand, setBrand] = useState("all");
  const [query, setQuery] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);

  const brands = useMemo(() => [...new Map(items.map((i) => [i.store, i.brandName])).entries()], [items]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (brand === "all" || i.store === brand) &&
        (!inStockOnly || i.inStock) &&
        (!q || i.name.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q)),
    );
  }, [items, brand, query, inStockOnly]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder="Search name or SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input max-w-[14rem]" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="all">All brands</option>
          {brands.map(([key, name]) => (
            <option key={key} value={key}>{name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} /> In stock only
        </label>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-600" /> Live · updated {new Date(data?.at ?? initial.at).toLocaleTimeString()}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-panel text-left text-xs uppercase tracking-wide text-muted">
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
                <td colSpan={6} className="px-3 py-10 text-center text-muted">No products match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ item }: { item: CatalogItem }) {
  const cart = useCart();
  const [qty, setQty] = useState(item.minQuantity);
  const [added, setAdded] = useState(false);
  const orderable = item.inStock && !item.restriction && item.dealerPrice !== null;

  return (
    <tr className="border-t border-line align-middle">
      <td className="px-3 py-2">
        <div className="flex items-center gap-3">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
          ) : (
            <div className="h-10 w-10 rounded bg-panel" />
          )}
          <div>
            <p className="font-medium">
              {item.featured && <span className="badge mr-1 bg-accent/10 text-accent">Featured</span>}
              {item.name}
            </p>
            <p className="text-xs text-muted">
              {item.sku ?? "No SKU"}
              {item.dealerNote && ` · ${item.dealerNote}`}
              {item.restriction && <span className="text-red-700"> · {item.restriction}</span>}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-muted">{item.brandName}</td>
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
      <td className="px-3 py-2 text-right font-medium">{item.dealerPrice !== null ? usd(item.dealerPrice) : "—"}</td>
      <td className="px-3 py-2">
        {orderable && (
          <div className="flex items-center justify-end gap-2">
            <input
              type="number"
              min={item.minQuantity}
              max={item.stockQuantity ?? undefined}
              value={qty}
              onChange={(e) => setQty(Math.max(item.minQuantity, Number(e.target.value) || item.minQuantity))}
              className="input w-20"
            />
            <button
              className="btn-ghost"
              onClick={() => {
                cart.add(
                  { id: item.id, name: item.name, sku: item.sku, brandName: item.brandName, store: item.store, unitPrice: item.dealerPrice!, minQuantity: item.minQuantity },
                  qty,
                );
                setAdded(true);
                setTimeout(() => setAdded(false), 1500);
              }}
            >
              {added ? "Added" : "Add"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
