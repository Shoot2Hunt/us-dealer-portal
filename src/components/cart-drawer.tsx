"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useCart, usd } from "./cart";

/** Flyout cart that slides in from the right. Always mounted so it can animate both ways. */
export function CartDrawer() {
  const cart = useCart();
  const { isOpen, close } = cart;
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes; the page behind doesn't scroll; focus moves in and comes back out.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [isOpen, close]);

  return (
    <div className={`fixed inset-0 z-50 ${isOpen ? "" : "pointer-events-none"}`} inert={!isOpen}>
      {/* Backdrop */}
      <div
        onClick={close}
        aria-hidden="true"
        className={`absolute inset-0 bg-ink/40 backdrop-blur-[2px] transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0"}`}
      />

      <aside
        id="cart-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-400 ease-out-expo ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <header className="flex items-center gap-3 bg-linear-to-r from-ink to-ink-soft px-5 py-4 text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/90">
            <span className="icon-[lucide--shopping-cart] h-5 w-5" aria-hidden="true" />
          </span>
          <div className="flex-1">
            <h2 id="cart-drawer-title" className="text-lg font-semibold leading-tight">Your cart</h2>
            <p className="text-xs text-white/60">
              {cart.count ? `${cart.count.toLocaleString()} item${cart.count === 1 ? "" : "s"}` : "Nothing here yet"}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={close}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:rotate-90 hover:bg-white/10 hover:text-white"
            aria-label="Close cart"
          >
            <span className="icon-[lucide--x] h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        {cart.lines.length ? (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {cart.priceNotice && (
                <p className="mb-3 flex items-start gap-2 rounded-md bg-accent-soft px-3 py-2 text-xs text-accent-dark">
                  <span className="icon-[lucide--info] mt-px h-4 w-4 shrink-0" aria-hidden="true" />
                  {cart.priceNotice}
                </p>
              )}
              <ul className="space-y-3">
                {cart.lines.map((l, i) => (
                  <li
                    key={l.id}
                    style={isOpen ? { animationDelay: `${Math.min(i, 8) * 40 + 120}ms` } : undefined}
                    className={`group rounded-lg border border-line p-3 transition hover:border-accent/30 hover:shadow-sm ${isOpen ? "animate-fade-up" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">{l.brandName}</p>
                        <p className="truncate text-sm font-medium" title={l.name}>{l.name}</p>
                        <p className="text-xs text-muted">{l.sku ?? "No SKU"} · {usd(l.unitPrice)} each</p>
                      </div>
                      <button
                        onClick={() => cart.remove(l.id)}
                        className="rounded p-1 text-muted opacity-60 transition hover:bg-red-50 hover:text-red-700 group-hover:opacity-100"
                        aria-label={`Remove ${l.name}`}
                      >
                        <span className="icon-[lucide--trash-2] h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <Stepper
                        value={l.quantity}
                        min={l.minQuantity}
                        label={l.name}
                        onChange={(q) => cart.setQuantity(l.id, q)}
                      />
                      <p className="font-semibold tabular-nums">{usd(l.unitPrice * l.quantity)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <footer className="space-y-3 border-t border-line bg-panel px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted">Subtotal</span>
                <span className="font-display text-xl font-bold tabular-nums">{usd(cart.total)}</span>
              </div>
              <p className="text-xs text-muted">Stock and prices are re-checked when you place the order.</p>
              <div className="grid grid-cols-2 gap-2">
                <Link href="/cart" onClick={close} className="btn-ghost py-2">
                  <span className="icon-[lucide--list] h-4 w-4" aria-hidden="true" /> View cart
                </Link>
                <Link href="/checkout" onClick={close} className="btn-accent">
                  Checkout <span className="icon-[lucide--arrow-right] h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
              <span className="icon-[lucide--package-open] h-8 w-8" aria-hidden="true" />
            </span>
            <p className="font-display font-semibold">Your cart is empty</p>
            <p className="text-sm text-muted">Add products from the inventory and they&apos;ll show up here.</p>
            <Link href="/inventory" onClick={close} className="btn mt-2">
              <span className="icon-[lucide--boxes] h-4 w-4" aria-hidden="true" /> Browse inventory
            </Link>
          </div>
        )}
      </aside>
    </div>
  );
}

function Stepper({ value, min, label, onChange }: { value: number; min: number; label: string; onChange: (n: number) => void }) {
  const btn = "flex h-8 w-8 items-center justify-center text-muted transition hover:bg-panel hover:text-ink active:scale-90 disabled:opacity-40";
  return (
    <div className="inline-flex items-center overflow-hidden rounded-md border border-line">
      <button className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Decrease quantity of ${label}`}>
        <span className="icon-[lucide--minus] h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="h-8 w-12 border-x border-line text-center text-sm tabular-nums outline-none [appearance:textfield] focus:bg-accent-soft/50 [&::-webkit-inner-spin-button]:appearance-none"
        aria-label={`Quantity of ${label}`}
      />
      <button className={btn} onClick={() => onChange(value + 1)} aria-label={`Increase quantity of ${label}`}>
        <span className="icon-[lucide--plus] h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
