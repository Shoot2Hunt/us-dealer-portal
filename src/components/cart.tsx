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
  /** Flyout cart drawer. */
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Increments each time something lands in the cart; drives the header icon's bump animation. */
  bumpKey: number;
  bump: () => void;
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

  const [isOpen, setIsOpen] = useState(false);
  const [bumpKey, setBumpKey] = useState(0);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const bump = useCallback(() => setBumpKey((k) => k + 1), []);

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
      isOpen,
      open,
      close,
      bumpKey,
      bump,
    }),
    [lines, save, priceNotice, isOpen, open, close, bumpKey, bump],
  );

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used inside CartProvider");
  return cart;
}


/**
 * Animates a small parcel from `from` (e.g. the Add button) along an arc into the header
 * cart icon (`[data-cart-target]`). Resolves when it lands, or straight away when there is
 * nowhere to fly to or the user prefers reduced motion.
 */
export function flyToCart(from: Element): Promise<void> {
  const target = document.querySelector("[data-cart-target]");
  if (!target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();

  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const size = 28;
  const x0 = a.left + a.width / 2 - size / 2;
  const y0 = a.top + a.height / 2 - size / 2;
  const dx = b.left + b.width / 2 - size / 2 - x0;
  const dy = b.top + b.height / 2 - size / 2 - y0;

  const dot = document.createElement("div");
  dot.setAttribute("aria-hidden", "true");
  dot.className =
    "pointer-events-none fixed z-[100] flex items-center justify-center rounded-full bg-linear-to-br from-accent-light to-accent text-white shadow-lg shadow-accent/40";
  Object.assign(dot.style, { left: `${x0}px`, top: `${y0}px`, width: `${size}px`, height: `${size}px` });
  const icon = document.createElement("span");
  icon.className = "icon-[lucide--package] h-4 w-4";
  dot.append(icon);
  document.body.append(dot);

  // The midpoint is lifted above both ends, so the parcel travels in an arc.
  const lift = Math.min(160, Math.abs(dy) / 2 + 60);
  const anim = dot.animate(
    [
      { transform: "translate(0, 0) scale(0.6)", opacity: 0 },
      { transform: "translate(0, -12px) scale(1.1)", opacity: 1, offset: 0.12 },
      { transform: `translate(${dx * 0.55}px, ${Math.min(0, dy) * 0.55 - lift}px) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0.6 },
    ],
    { duration: 700, easing: "cubic-bezier(0.45, 0, 0.25, 1)" },
  );
  return anim.finished.then(
    () => dot.remove(),
    () => dot.remove(),
  );
}
