"use client";

import { useCart } from "./cart";

/** Header cart button. Opens the flyout; bumps when something lands in the cart. */
export function CartLink() {
  const { count, open, isOpen, bumpKey } = useCart();
  return (
    <button
      type="button"
      onClick={open}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls="cart-drawer"
      className="group relative inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white ring-1 ring-white/15 transition duration-150 hover:bg-white/20 hover:ring-white/30 active:scale-95"
    >
      {/* Re-keyed on every landing so the bump animation restarts. */}
      <span key={bumpKey} data-cart-target className={`inline-flex ${bumpKey ? "animate-cart-bump" : ""}`}>
        <span className="icon-[lucide--shopping-cart] h-4.5 w-4.5 transition-transform duration-200 group-hover:-rotate-8" aria-hidden="true" />
      </span>
      Cart
      {count > 0 && (
        <span
          key={count}
          className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 animate-pop-in items-center justify-center rounded-full bg-accent-light px-1 text-[11px] font-semibold text-white shadow ring-2 ring-ink"
        >
          {count > 999 ? "999+" : count}
          <span className="sr-only"> items</span>
        </span>
      )}
    </button>
  );
}
