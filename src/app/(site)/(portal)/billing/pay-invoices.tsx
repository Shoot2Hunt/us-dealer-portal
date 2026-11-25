"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usd } from "@/lib/money";
import { loadAcceptJs, tokenize, type BankInput } from "@/lib/accept";
import { CardFields, cardholderOf, emptyCardForm } from "@/components/card-fields";
import type { Address } from "@/lib/db/schema";

export type InvoiceRow = {
  orderId: string;
  number: number;
  poNumber: string | null;
  terms: boolean;
  total: number;
  paid: number;
  clearing: number;
  balance: number;
  daysPastDue: number;
  daysUntilDue: number;
  orderedLabel: string;
  dueLabel: string;
};

type Method = "card" | "ach";
const emptyBank: BankInput = { routingNumber: "", accountNumber: "", nameOnAccount: "", accountType: "businessChecking" };
const toCents = (n: number) => Math.round(n * 100);

export function PayInvoices({
  invoices,
  methods,
  preselect,
  preferred,
  acceptJs,
  check,
  shippingAddress,
  billingAddress,
}: {
  /** Shipping address on file, for "Billing address is same as shipping". */
  shippingAddress: Address | null;
  /** A saved billing address that differs from shipping: pre-fills the billing fields. */
  billingAddress: Address | null;
  invoices: InvoiceRow[];
  /** Online methods that are switched on. Empty = pay by check only. */
  methods: readonly Method[];
  /** Order id from "Pay this invoice" on an order page: start with only that one selected. */
  preselect?: string;
  /** The dealer's preferred method (Billing details), when it's card or ACH. */
  preferred?: Method;
  acceptJs: { url: string; apiLoginId: string; clientKey: string };
  check: { payableTo?: string; address?: string } | null;
}) {
  const router = useRouter();
  const payable = invoices.filter((i) => i.balance > 0);
  const pastDueIds = payable.filter((i) => i.daysPastDue > 0).map((i) => i.orderId);
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (preselect && payable.some((i) => i.orderId === preselect)) return new Set([preselect]);
    return new Set(pastDueIds.length ? pastDueIds : payable.map((i) => i.orderId));
  });
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [partial, setPartial] = useState("");
  const [method, setMethod] = useState<Method>(preferred && methods.includes(preferred) ? preferred : (methods[0] ?? "card"));
  const nameFrom = billingAddress ?? shippingAddress;
  // Starts unchecked when there's a different billing address saved, or no shipping address to use.
  const emptyCard = { ...emptyCardForm(nameFrom ? `${nameFrom.firstName} ${nameFrom.lastName}`.trim() : "", billingAddress), same: Boolean(shippingAddress) && !billingAddress };
  const [card, setCard] = useState(emptyCard);
  const [bank, setBank] = useState(emptyBank);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load Accept.js up front, so it is ready by the time they pay.
  useEffect(() => {
    if (methods.length) loadAcceptJs(acceptJs.url).catch(() => {});
  }, [methods.length, acceptJs.url]);

  const selectedTotal = useMemo(
    () => payable.filter((i) => selected.has(i.orderId)).reduce((s, i) => s + toCents(i.balance), 0) / 100,
    [payable, selected],
  );
  const amount = mode === "full" ? selectedTotal : Math.round((Number(partial.replace(/[$,\s]/g, "")) || 0) * 100) / 100;
  const amountProblem =
    !selected.size ? "Select at least one invoice."
    : !(amount > 0) ? "Enter an amount."
    : toCents(amount) > toCents(selectedTotal) ? `That's more than the ${usd(selectedTotal)} owed on the selected invoices.`
    : amount < 1 && toCents(amount) !== toCents(selectedTotal) ? "The smallest partial payment is $1.00."
    : null;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectOnly = (ids: string[]) => setSelected(new Set(ids));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (amountProblem) return setError(amountProblem);
    setSubmitting(true);
    try {
      await loadAcceptJs(acceptJs.url);
      const forCard = method === "card" ? cardholderOf(card, shippingAddress) : null;
      const token = await tokenize(acceptJs, forCard ? { card: forCard.card } : { bank });
      const res = await fetch("/api/invoices/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [...selected], amount, method, token, cardholder: forCard?.holder }),
      });
      const r = await res.json();
      if (!r.ok) throw new Error(r.error ?? "The payment didn't go through.");
      setDone(
        `Thanks — ${usd(r.amount)} was ${r.clearing ? "submitted and will clear in a few business days" : "paid"} toward order${r.orders.length === 1 ? "" : "s"} ${r.orders.map((n: number) => `#${n}`).join(", ")}. A receipt is on its way to your email.`,
      );
      setCard(emptyCard);
      setBank(emptyBank);
      setPartial("");
      setMode("full");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment didn't go through.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Open invoices</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            {pastDueIds.length > 0 && (
              <button type="button" className="btn-ghost" onClick={() => selectOnly(pastDueIds)}>
                Select past due
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => selectOnly(payable.map((i) => i.orderId))}>
              Select all
            </button>
            {selected.size > 0 && (
              <button type="button" className="btn-ghost" onClick={() => selectOnly([])}>
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 px-3 py-2"><span className="sr-only">Pay</span></th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const canPay = i.balance > 0;
                const on = selected.has(i.orderId);
                return (
                  <tr
                    key={i.orderId}
                    onClick={canPay ? () => toggle(i.orderId) : undefined}
                    className={`border-t border-line transition-colors ${canPay ? "cursor-pointer hover:bg-panel" : "opacity-70"} ${on ? "bg-accent-soft/60" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Pay order #${i.number}`}
                        checked={on}
                        disabled={!canPay}
                        onChange={() => toggle(i.orderId)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/orders/${i.orderId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-accent hover:underline">
                        #{i.number}
                      </Link>
                      <span className="block text-xs text-muted">
                        {i.orderedLabel}
                        {i.poNumber && ` · PO ${i.poNumber}`}
                        {i.terms ? " · Invoice" : " · Check"}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{i.dueLabel}</td>
                    <td className="px-3 py-2"><DueBadge i={i} /></td>
                    <td className="px-3 py-2 text-right">{usd(i.total)}</td>
                    <td className="px-3 py-2 text-right text-muted">
                      {usd(i.paid)}
                      {i.clearing > 0 && <span className="block text-xs">+{usd(i.clearing)} clearing</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{usd(i.balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {check && (check.payableTo || check.address) && (
          <p className="text-xs text-muted">
            Paying by check instead? Make it payable to <strong>{check.payableTo ?? "us"}</strong>
            {check.address && <> and mail it to {check.address.replace(/\s*\n\s*/g, ", ")}</>}. Write the order numbers on the check.
          </p>
        )}
      </section>

      <form onSubmit={submit} className="card h-fit space-y-4 lg:sticky lg:top-24">
        <h2 className="flex items-center gap-2 font-semibold">
          <span className="icon-[lucide--credit-card] h-5 w-5 text-accent" aria-hidden="true" /> Make a payment
        </h2>

        <div className="flex justify-between text-sm">
          <span className="text-muted">Selected ({selected.size})</span>
          <span className="font-medium">{usd(selectedTotal)}</span>
        </div>

        <fieldset className="space-y-2 text-sm">
          <legend className="sr-only">How much</legend>
          <label className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${mode === "full" ? "border-accent bg-accent-soft/50" : "border-line hover:bg-panel"}`}>
            <input type="radio" name="mode" checked={mode === "full"} onChange={() => setMode("full")} />
            <span className="flex-1">Pay in full</span>
            <strong>{usd(selectedTotal)}</strong>
          </label>
          <label className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-md border p-3 transition-colors ${mode === "partial" ? "border-accent bg-accent-soft/50" : "border-line hover:bg-panel"}`}>
            <input type="radio" name="mode" checked={mode === "partial"} onChange={() => setMode("partial")} />
            <span className="flex-1">Pay part</span>
            {mode === "partial" && (
              <span className="relative w-32">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                <input
                  className="input pl-6 text-right"
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="Amount to pay"
                  value={partial}
                  autoFocus
                  onChange={(e) => setPartial(e.target.value)}
                />
              </span>
            )}
            {mode === "partial" && <span className="basis-full text-xs text-muted">Applied to the oldest due date first.</span>}
          </label>
        </fieldset>

        {methods.length === 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Online payments aren&apos;t available right now. {check ? "You can mail a check (details below the invoices)." : "Please contact us to pay."}
          </p>
        ) : (
          <>
            {methods.length > 1 && (
              <div className="flex rounded-md border border-line p-0.5 text-sm">
                {methods.map((m) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`flex-1 rounded px-3 py-1.5 transition-colors ${method === m ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
                  >
                    {m === "card" ? "Card" : "Bank (ACH)"}
                  </button>
                ))}
              </div>
            )}
            {method === "card" ? (
              <CardFields idPrefix="invoice-card" value={card} onChange={setCard} sameAs={shippingAddress} />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <input className="input col-span-2" placeholder="Name on account" value={bank.nameOnAccount} onChange={(e) => setBank({ ...bank, nameOnAccount: e.target.value })} required />
                <input className="input" placeholder="Routing number" inputMode="numeric" value={bank.routingNumber} onChange={(e) => setBank({ ...bank, routingNumber: e.target.value })} required />
                <input className="input" placeholder="Account number" inputMode="numeric" value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })} required />
                <select className="input col-span-2" value={bank.accountType} onChange={(e) => setBank({ ...bank, accountType: e.target.value as BankInput["accountType"] })}>
                  <option value="businessChecking">Business checking</option>
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                </select>
                <p className="col-span-2 text-xs text-muted">Bank payments take a few business days to clear.</p>
              </div>
            )}

            {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
            {done && <p role="status" className="animate-fade-up rounded bg-green-50 p-2 text-sm text-green-900">{done}</p>}
            <button className="btn-accent w-full justify-center" disabled={submitting || Boolean(amountProblem)} title={amountProblem ?? undefined}>
              {submitting ? (
                <>
                  <span className="icon-[lucide--loader-circle] h-4 w-4 animate-spin" aria-hidden="true" /> Processing…
                </>
              ) : (
                `Pay ${usd(amount > 0 ? amount : 0)}`
              )}
            </button>
            {amountProblem && selected.size > 0 && mode === "partial" && partial && <p className="text-xs text-red-700">{amountProblem}</p>}
            <p className="text-xs text-muted">Card and bank details go straight to Authorize.net and are never stored by the portal.</p>
          </>
        )}
      </form>
    </div>
  );
}

function DueBadge({ i }: { i: InvoiceRow }) {
  if (i.balance <= 0) return <span className="badge bg-panel text-muted">Clearing</span>;
  if (i.daysPastDue > 0) return <span className="badge bg-red-50 text-red-700">{i.daysPastDue} day{i.daysPastDue === 1 ? "" : "s"} past due</span>;
  if (i.daysUntilDue === 0) return <span className="badge bg-amber-50 text-amber-800">Due today</span>;
  return <span className="badge bg-green-50 text-green-800">Due in {i.daysUntilDue} day{i.daysUntilDue === 1 ? "" : "s"}</span>;
}
