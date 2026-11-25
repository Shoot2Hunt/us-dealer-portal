"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Address } from "@/lib/db/schema";
import type { PaymentSettings } from "@/sanity/content";
import { useCart, usd } from "@/components/cart";
import { PhoneInput } from "@/components/phone-input";
import { loadAcceptJs, tokenize, type BankInput } from "@/lib/accept";
import { CardFields, cardholderOf, emptyCardForm, type CardForm } from "@/components/card-fields";

type Method = "card" | "ach" | "check" | "terms";

/** Net terms for this dealer (Admin → Dealers), from getTermsStatus. */
export type CheckoutTerms = { days: number; dueLabel: string; available: boolean; reason?: string; creditAvailable: number | null } | null;
type Part = { key: number; method: Method; amount: string; card: CardForm; bank: BankInput };

const METHOD_LABEL: Record<Method, string> = { card: "Credit card", ach: "ACH (bank account)", check: "Mailed check", terms: "Invoice me" };
const emptyBank: BankInput = { routingNumber: "", accountNumber: "", nameOnAccount: "", accountType: "businessChecking" };

export function CheckoutForm({
  settings,
  defaultAddress,
  acceptJs,
  onlinePayments,
  terms,
  preferred,
}: {
  /** The dealer's preferred method (Billing details), selected first when available. */
  preferred?: Method | null;
  settings: PaymentSettings;
  terms: CheckoutTerms;
  /** False when Authorize.net isn't configured: card and ACH are hidden. */
  onlinePayments: boolean;
  defaultAddress: Address;
  acceptJs: { url: string; apiLoginId: string; clientKey: string };
}) {
  const cart = useCart();
  const router = useRouter();
  const methods = (["terms", "card", "ach", "check"] as Method[]).filter(
    (m) =>
      (m === "terms" && terms?.available) ||
      (m === "card" && settings.enableCard && onlinePayments) ||
      (m === "ach" && settings.enableAch && onlinePayments) ||
      (m === "check" && settings.enableCheck),
  );
  const canSplit = settings.allowSplit && settings.maxSplitParts > 1;

  const [address, setAddress] = useState<Address>(defaultAddress);
  const emptyCard = emptyCardForm(`${defaultAddress.firstName} ${defaultAddress.lastName}`.trim());
  const [poNumber, setPoNumber] = useState("");
  const [mode, setMode] = useState<"single" | "split">("single");
  const [parts, setParts] = useState<Part[]>([{ key: 1, method: preferred && methods.includes(preferred) ? preferred : (methods[0] ?? "card"), amount: "", card: emptyCard, bank: emptyBank }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load Accept.js as soon as card or ACH is picked, so it is ready by the time they pay.
  const needsAccept = parts.some((p) => p.method === "card" || p.method === "ach");
  useEffect(() => {
    if (needsAccept) loadAcceptJs(acceptJs.url).catch(() => {});
  }, [needsAccept, acceptJs.url]);

  // Discount code. A code applied to a different cart (items or quantities changed) is set
  // aside until the dealer applies it again, so the total shown is never out of date.
  const cartKey = cart.lines.map((l) => `${l.id}x${l.quantity}`).join(",");
  const [codeInput, setCodeInput] = useState("");
  const [applied, setApplied] = useState<{ code: string; description: string | null; discount: number; cartKey: string } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const discount = applied && applied.cartKey === cartKey ? applied : null;
  const staleCode = applied && applied.cartKey !== cartKey ? applied.code : null;

  async function applyCode(code: string) {
    if (!code.trim()) return;
    setApplying(true);
    setCodeError(null);
    try {
      const res = await fetch("/api/discount-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), lines: cart.lines.map((l) => ({ id: l.id, quantity: l.quantity })) }),
      });
      const r = await res.json();
      if (!r.ok) {
        setApplied(null);
        setCodeError(r.error ?? "That code isn't valid.");
      } else {
        setApplied({ code: r.code, description: r.description, discount: r.discount, cartKey });
        setCodeInput("");
      }
    } catch {
      setCodeError("Couldn't check that code. Try again.");
    } finally {
      setApplying(false);
    }
  }

  const subtotal = Math.round(cart.total * 100) / 100;
  const total = Math.round((subtotal - (discount?.discount ?? 0)) * 100) / 100;
  const allocated = useMemo(() => parts.reduce((s, p) => s + (Number(p.amount) || 0), 0), [parts]);
  const remaining = Math.round((total - allocated) * 100) / 100;

  const update = (key: number, patch: Partial<Part>) => setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  if (!cart.lines.length) {
    return (
      <div className="card text-center">
        <p>Your cart is empty.</p>
        <Link href="/inventory" className="btn mt-4">Browse inventory</Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const plan = mode === "single" ? [{ ...parts[0], amount: total.toFixed(2) }] : parts;
    if (mode === "split" && Math.abs(remaining) > 0.001) {
      setError(`The payments must add up to ${usd(total)}. ${remaining > 0 ? `${usd(remaining)} is left to assign.` : `They're over by ${usd(-remaining)}.`}`);
      return;
    }
    setSubmitting(true);
    try {
      if (plan.some((p) => p.method === "card" || p.method === "ach")) await loadAcceptJs(acceptJs.url);
      const payments = [];
      for (const p of plan) {
        const amount = Number(p.amount);
        if (!(amount > 0)) throw new Error("Each payment needs an amount.");
        if (p.method === "check" || p.method === "terms") payments.push({ method: p.method, amount });
        else {
          if (p.method === "card") {
            const { holder, card } = cardholderOf(p.card, address);
            const token = await tokenize(acceptJs, { card });
            payments.push({ method: p.method, amount, token, cardholder: holder });
          } else {
            const token = await tokenize(acceptJs, { bank: p.bank });
            payments.push({ method: p.method, amount, token });
          }
        }
      }
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: cart.lines.map((l) => ({ id: l.id, quantity: l.quantity })),
          shipping: address,
          poNumber: poNumber || undefined,
          discountCode: discount?.code,
          payments,
        }),
      });
      const result = await res.json();
      if (!result.ok) throw new Error(result.error ?? "Checkout failed.");
      cart.clear();
      router.push(`/orders/${result.orderId}?placed=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setSubmitting(false);
    }
  }

  const field = (key: keyof Address, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={address[key] ?? ""} onChange={(e) => setAddress({ ...address, [key]: e.target.value })} {...props} />
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>

        <section className="card space-y-4">
          <h2 className="font-semibold">Ship to</h2>
          <div className="grid grid-cols-2 gap-3">
            {field("firstName", "First name", { required: true })}
            {field("lastName", "Last name", { required: true })}
          </div>
          {field("company", "Business")}
          {field("address1", "Address", { required: true })}
          {field("address2", "Address line 2")}
          <div className="grid grid-cols-3 gap-3">
            {field("city", "City", { required: true })}
            {/* Same rules as the server (src/lib/orders.ts), so mistakes are caught before submitting. */}
            {field("state", "State", { required: true, minLength: 2, maxLength: 2, pattern: "[A-Za-z]{2}", title: "2-letter state code, e.g. ID", placeholder: "ID" })}
            {field("postcode", "ZIP", { required: true, pattern: "[0-9]{5}(-[0-9]{4})?", title: "5-digit ZIP code, e.g. 83814", inputMode: "numeric", maxLength: 10 })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ship-phone">Phone</label>
              <PhoneInput id="ship-phone" value={address.phone ?? ""} onChange={(phone) => setAddress((a) => ({ ...a, phone }))} autoComplete="shipping tel" />
            </div>
            <div>
              <label className="label">PO number (optional)</label>
              <input className="input" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
            </div>
          </div>
        </section>

        <section className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Payment</h2>
            {canSplit && (
              <div className="flex rounded-md border border-line p-0.5 text-sm">
                {(["single", "split"] as const).map((m) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => setMode(m)}
                    className={`rounded px-3 py-1 ${mode === m ? "bg-ink text-white" : "text-muted"}`}
                  >
                    {m === "single" ? "Single payment" : "Split payment"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!onlinePayments && (settings.enableCard || settings.enableAch) && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="icon-[lucide--info] mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Card and bank payments aren&apos;t available right now.{methods.length ? " You can still pay by check." : ""}
            </p>
          )}
          {terms && !terms.available && terms.reason && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="icon-[lucide--file-clock] mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Invoicing is paused: {terms.reason}{" "}
                <Link href="/billing" className="font-medium underline">Go to Billing</Link>
              </span>
            </p>
          )}
          {methods.length === 0 && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              No payment methods are available at the moment, so orders can&apos;t be placed. Please contact us.
            </p>
          )}
          {methods.length > 0 && (mode === "single" ? parts.slice(0, 1) : parts).map((p, i) => (
            <div key={p.key} className="space-y-3 rounded-md border border-line p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem] flex-1">
                  <label className="label">{mode === "split" ? `Payment ${i + 1}` : "Pay with"}</label>
                  <select className="input" value={p.method} onChange={(e) => update(p.key, { method: e.target.value as Method })}>
                    {methods.map((m) => (
                      <option key={m} value={m}>{m === "terms" && terms ? `Invoice me (Net ${terms.days})` : METHOD_LABEL[m]}</option>
                    ))}
                  </select>
                </div>
                {mode === "split" && (
                  <div className="w-36">
                    <label className="label">Amount</label>
                    <input className="input" inputMode="decimal" placeholder="0.00" value={p.amount} onChange={(e) => update(p.key, { amount: e.target.value })} required />
                  </div>
                )}
                {mode === "split" && parts.length > 1 && (
                  <button type="button" className="btn-ghost" onClick={() => setParts(parts.filter((x) => x.key !== p.key))}>Remove</button>
                )}
              </div>

              {p.method === "card" && (
                <CardFields idPrefix={`card-${p.key}`} value={p.card} onChange={(card) => update(p.key, { card })} sameAs={address} />
              )}
              {p.method === "ach" && (
                <div className="grid grid-cols-2 gap-3">
                  <input className="input col-span-2" placeholder="Name on account" value={p.bank.nameOnAccount} onChange={(e) => update(p.key, { bank: { ...p.bank, nameOnAccount: e.target.value } })} required />
                  <input className="input" placeholder="Routing number" inputMode="numeric" value={p.bank.routingNumber} onChange={(e) => update(p.key, { bank: { ...p.bank, routingNumber: e.target.value } })} required />
                  <input className="input" placeholder="Account number" inputMode="numeric" value={p.bank.accountNumber} onChange={(e) => update(p.key, { bank: { ...p.bank, accountNumber: e.target.value } })} required />
                  <select className="input col-span-2" value={p.bank.accountType} onChange={(e) => update(p.key, { bank: { ...p.bank, accountType: e.target.value as BankInput["accountType"] } })}>
                    <option value="businessChecking">Business checking</option>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                  </select>
                  <p className="col-span-2 text-xs text-muted">Orders paid by ACH ship once the payment settles, usually a few business days.</p>
                </div>
              )}
              {p.method === "terms" && terms && (
                <div className="space-y-1 rounded bg-panel p-3 text-sm">
                  <p className="flex items-center gap-1.5 font-medium">
                    <span className="icon-[lucide--file-clock] h-4 w-4 text-accent" aria-hidden="true" /> Ships now — payment due {terms.dueLabel}.
                  </p>
                  <p className="text-muted">Pay in full or in parts any time from the Billing page.</p>
                  {terms.creditAvailable !== null && <p className="text-muted">Available credit: <strong className="text-ink">{usd(terms.creditAvailable)}</strong></p>}
                </div>
              )}
              {p.method === "check" && (
                <div className="rounded bg-panel p-3 text-sm">
                  <p>Your order is reserved and ships when the check arrives.</p>
                  {settings.checkPayableTo && <p className="mt-1">Payable to: <strong>{settings.checkPayableTo}</strong></p>}
                  {settings.checkMailingAddress && <p className="mt-1 whitespace-pre-line text-muted">{settings.checkMailingAddress}</p>}
                </div>
              )}
            </div>
          ))}

          {mode === "split" && (
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="btn-ghost"
                disabled={parts.length >= settings.maxSplitParts}
                onClick={() => setParts([...parts, { key: Date.now(), method: methods[0] ?? "card", amount: remaining > 0 ? remaining.toFixed(2) : "", card: emptyCard, bank: emptyBank }])}
              >
                Add another payment method
              </button>
              <span className={Math.abs(remaining) < 0.001 ? "text-green-700" : "text-muted"}>
                {Math.abs(remaining) < 0.001 ? "Fully assigned" : `${usd(remaining)} left to assign`}
              </span>
            </div>
          )}
          {settings.checkoutNote && <p className="text-xs text-muted">{settings.checkoutNote}</p>}
        </section>
      </div>

      <aside className="card h-fit space-y-3">
        <h2 className="font-semibold">Order summary</h2>
        <ul className="space-y-2 text-sm">
          {cart.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-3">
              <span>{l.quantity} × {l.name}<span className="block text-xs text-muted">{l.brandName}</span></span>
              <span>{usd(l.unitPrice * l.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-2 border-t border-line pt-3">
          {discount ? (
            <div className="flex animate-fade-up items-start justify-between gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-semibold text-green-800">
                  <span className="icon-[lucide--ticket-percent] h-4 w-4" aria-hidden="true" /> {discount.code}
                </span>
                {discount.description && <span className="block text-xs text-green-800/80">{discount.description}</span>}
              </span>
              <button type="button" onClick={() => setApplied(null)} className="text-xs text-green-800/80 underline hover:text-green-900">Remove</button>
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="discount-code">Discount code</label>
              <div className="flex gap-2">
                <input
                  id="discount-code"
                  className="input uppercase placeholder:normal-case"
                  placeholder="Enter code"
                  value={codeInput}
                  maxLength={30}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void applyCode(codeInput);
                    }
                  }}
                />
                <button type="button" className="btn-ghost shrink-0" disabled={applying || !codeInput.trim()} onClick={() => applyCode(codeInput)}>
                  {applying ? <span className="icon-[lucide--loader-circle] h-4 w-4 animate-spin" aria-hidden="true" /> : "Apply"}
                </button>
              </div>
              {codeError && <p role="alert" className="mt-1 text-xs text-red-700">{codeError}</p>}
              {staleCode && (
                <p className="mt-1 text-xs text-amber-800">
                  Your cart changed.{" "}
                  <button type="button" className="underline" onClick={() => applyCode(staleCode)}>Re-apply {staleCode}</button>
                </p>
              )}
            </div>
          )}
          <div className="flex justify-between text-sm text-muted">
            <span>Subtotal</span>
            <span>{usd(subtotal)}</span>
          </div>
          {discount && (
            <div className="flex justify-between text-sm font-medium text-green-700">
              <span>Discount</span>
              <span>−{usd(discount.discount)}</span>
            </div>
          )}
        </div>
        <div className="flex justify-between border-t border-line pt-3 text-lg font-semibold">
          <span>Total</span>
          <span key={total} className="animate-fade-in">{usd(total)}</span>
        </div>
        <p className="text-xs text-muted">Shipping and any applicable tax are invoiced by each brand.</p>
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
        <button className="btn-accent w-full" disabled={submitting || methods.length === 0}>{submitting ? "Placing order…" : "Place order"}</button>
        <p className="text-xs text-muted">Card and bank details go straight to Authorize.net and are never stored by the portal.</p>
      </aside>
    </form>
  );
}
