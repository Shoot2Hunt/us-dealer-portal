"use client";

import Link from "next/link";
import { useCart, usd } from "@/components/cart";

export default function CartPage() {
  const cart = useCart();
  if (!cart.lines.length) {
    return (
      <div className="card text-center">
        <p>Your cart is empty.</p>
        <Link href="/inventory" className="btn mt-4">Browse inventory</Link>
      </div>
    );
  }
  const byBrand = Map.groupBy(cart.lines, (l) => l.brandName);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Cart</h1>
        {cart.priceNotice && <p className="rounded-md bg-accent/5 px-3 py-2 text-sm">{cart.priceNotice}</p>}
        {[...byBrand].map(([brand, lines]) => (
          <section key={brand} className="card">
            <h2 className="mb-3 font-semibold">{brand}</h2>
            <ul className="divide-y divide-line">
              {lines.map((l) => (
                <li key={l.id} className="flex items-center gap-4 py-3 text-sm">
                  <div className="flex-1">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-muted">{l.sku} · {usd(l.unitPrice)} each</p>
                  </div>
                  <input
                    type="number"
                    min={l.minQuantity}
                    value={l.quantity}
                    onChange={(e) => cart.setQuantity(l.id, Math.max(l.minQuantity, Number(e.target.value) || l.minQuantity))}
                    className="input w-20"
                  />
                  <p className="w-24 text-right font-medium">{usd(l.unitPrice * l.quantity)}</p>
                  <button onClick={() => cart.remove(l.id)} className="text-xs text-muted hover:text-red-700">Remove</button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <aside className="card h-fit space-y-4">
        <div className="flex justify-between text-lg font-semibold">
          <span>Total</span>
          <span>{usd(cart.total)}</span>
        </div>
        <p className="text-xs text-muted">One checkout and one payment, even across brands. Stock and prices are re-checked when you place the order.</p>
        <Link href="/checkout" className="btn-accent w-full">Checkout</Link>
      </aside>
    </div>
  );
}
