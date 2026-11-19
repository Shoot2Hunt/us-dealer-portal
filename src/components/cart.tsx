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
    [lines, save],
  );

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used inside CartProvider");
  return cart;
}

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
