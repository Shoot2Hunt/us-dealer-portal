"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** Snapshot for display only; the server re-prices everything at checkout. */
export type CartLine = {
  id: number;
  quantity: number;
  name: string;
  sku: string | null;
  brandName: string;
  store: string;
  unitPrice: number;
  minQuantity: number;
};

type Cart = {
  lines: CartLine[];
  /** Set when a server price refresh changed something in the cart. */
  priceNotice: string | null;
  count: number;
  total: number;
  add: (line: Omit<CartLine, "quantity">, quantity: number) => void;
  setQuantity: (id: number, quantity: number) => void;
  remove: (id: number) => void;
  clear: () => void;
};

const CartContext = createContext<Cart | null>(null);
const KEY = "dealer-portal-cart";

export function CartProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const storageKey = `${KEY}:${userId}`;
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage once on mount
      if (saved) setLines(JSON.parse(saved));
    } catch {}
  }, [storageKey]);

  // Refresh the price snapshot from the server whenever the set of items changes
  // (and on load), so a tier change or price edit never leaves a stale total.
  const [priceNotice, setPriceNotice] = useState<string | null>(null);
  const idsKey = lines.map((l) => l.id).sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    fetch(`/api/cart-prices?ids=${idsKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res: { prices: Record<string, number | null> } | null) => {
        if (!res || cancelled) return;
        setLines((cur) => {
          let changed = false;
          const next = cur.map((l) => {
            const p = res.prices[l.id];
            if (typeof p === "number" && Math.abs(p - l.unitPrice) > 0.004) {
              changed = true;
              return { ...l, unitPrice: p };
            }
            return l;
          });
          if (!changed) return cur;
          try {
            localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {}
          setPriceNotice("Prices in your cart were updated to your current pricing.");
          return next;
        });
      })
      .catch(() => {}); // Checkout re-prices on the server anyway.
    return () => {
      cancelled = true;
    };
  }, [idsKey, storageKey]);

  const save = useCallback(
    (next: CartLine[]) => {
      setLines(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
    },
    [storageKey],
  );

  const value = useMemo<Cart>(
    () => ({
      lines,
      priceNotice,
      count: lines.reduce((s, l) => s + l.quantity, 0),
      total: lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
      add: (line, quantity) => {
        const existing = lines.find((l) => l.id === line.id);
        save(existing ? lines.map((l) => (l.id === line.id ? { ...l, quantity: l.quantity + quantity } : l)) : [...lines, { ...line, quantity }]);
      },
      setQuantity: (id, quantity) => save(lines.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, quantity) } : l))),
      remove: (id) => save(lines.filter((l) => l.id !== id)),
      clear: () => save([]),
    }),
    [lines, save, priceNotice],
  );

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used inside CartProvider");
  return cart;
}

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
