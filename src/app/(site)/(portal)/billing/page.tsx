import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { acceptJsConfig, authnetConfig } from "@/lib/authnet";
import { formatDue, getInvoices, getTermsStatus } from "@/lib/invoices";
import { getPaymentSettings } from "@/sanity/content";
import { usd } from "@/components/cart";
import { PayInvoices, type InvoiceRow } from "./pay-invoices";
import { BillingDetails } from "./billing-details";
import { addressSchema } from "@/lib/orders";
import type { Address } from "@/lib/db/schema";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/billing";

export const metadata: Metadata = { title: "Billing" };

/** The dealer's open invoices (net terms and unpaid check orders), with full or partial payment. */
export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const [user, settings, sp] = await Promise.all([requireUser(), getPaymentSettings(), searchParams]);
  const [summary, terms] = await Promise.all([getInvoices(user.id), getTermsStatus(user, settings.enableTerms)]);
  const online = authnetConfig().ready;
  const methods = [...(online && settings.enableCard ? (["card"] as const) : []), ...(online && settings.enableAch ? (["ach"] as const) : [])];
  const pay = typeof sp.pay === "string" ? sp.pay : undefined;
  // Every method this dealer could use at checkout, for "preferred payment method".
  const usable: PaymentMethod[] = [
    ...(terms.approved ? (["terms"] as const) : []),
    ...methods,
    ...(settings.enableCheck ? (["check"] as const) : []),
  ];
  const savedBilling = addressSchema.safeParse(user.billingAddress);
  const shipping = addressSchema.safeParse(user.shippingAddress);

  const rows: InvoiceRow[] = summary.invoices.map((i) => ({
    ...i,
    orderedLabel: formatDue(i.orderedOn),
    dueLabel: formatDue(i.dueDate),
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted">Open invoices and what&apos;s due. Pay everything at once, pick invoices, or pay part of a balance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Past due"
          value={summary.pastDue}
          icon="icon-[lucide--alarm-clock]"
          tone={summary.pastDue > 0 ? "bad" : "neutral"}
          note={summary.pastDue > 0 ? `${summary.invoices.filter((i) => i.daysPastDue > 0).length} invoice(s) past their due date` : "Nothing past due"}
        />
        <Stat label="Current" value={summary.current} icon="icon-[lucide--calendar-clock]" tone="neutral" note="Not yet due" />
        <Stat
          label="Total balance"
          value={summary.total}
          icon="icon-[lucide--wallet]"
          tone={summary.total > 0 ? "accent" : "good"}
          note={summary.clearing > 0 ? `${usd(summary.clearing)} more is clearing` : summary.total > 0 ? "Past due + current" : "You're all paid up"}
        />
      </div>

      {terms.approved && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className="flex items-center gap-1.5">
            <span className="icon-[lucide--file-clock] h-4 w-4" aria-hidden="true" /> Your terms: <strong className="text-ink">Net {terms.days}</strong>
          </span>
          {terms.creditLimit !== null && (
            <span>
              Credit limit <strong className="text-ink">{usd(terms.creditLimit)}</strong> · available{" "}
              <strong className="text-ink">{usd(Math.max(0, terms.creditLimit - terms.owed))}</strong>
            </span>
          )}
          {!terms.available && terms.reason && <span className="text-red-700">{terms.reason}</span>}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-10 text-center">
          <span className="icon-[lucide--circle-check-big] h-10 w-10 text-green-600" aria-hidden="true" />
          <p className="font-medium">No open invoices.</p>
          <p className="text-sm text-muted">Orders you place on terms or pay by check show up here until they&apos;re paid.</p>
        </div>
      ) : (
        <PayInvoices
          invoices={rows}
          methods={methods}
          preselect={pay}
          preferred={user.preferredPaymentMethod === "card" || user.preferredPaymentMethod === "ach" ? user.preferredPaymentMethod : undefined}
          acceptJs={acceptJsConfig()}
          shippingAddress={shipping.success ? shipping.data : null}
          billingAddress={savedBilling.success && !sameAddress(savedBilling.data, shipping.success ? shipping.data : null) ? savedBilling.data : null}
          check={settings.enableCheck ? { payableTo: settings.checkPayableTo, address: settings.checkMailingAddress } : null}
        />
      )}

      <BillingDetails
        billingAddress={savedBilling.success ? savedBilling.data : null}
        shippingAddress={shipping.success ? shipping.data : null}
        loginEmail={user.email}
        billingEmail={user.billingEmail}
        preferred={user.preferredPaymentMethod}
        methods={usable.map((m) => ({ value: m, label: m === "terms" && terms.approved ? `Invoice me (Net ${terms.days})` : PAYMENT_METHOD_LABEL[m] }))}
      />
    </div>
  );
}

function Stat({ label, value, icon, tone, note }: { label: string; value: number; icon: string; tone: "bad" | "good" | "accent" | "neutral"; note: string }) {
  const tones = {
    bad: "border-red-200 bg-red-50 text-red-800",
    good: "border-green-200 bg-green-50 text-green-800",
    accent: "border-accent/30 bg-accent-soft text-accent-dark",
    neutral: "border-line bg-white text-ink",
  };
  return (
    <div className={`animate-fade-up rounded-lg border p-5 ${tones[tone]}`}>
      <p className="flex items-center gap-2 text-sm font-medium opacity-80">
        <span className={`${icon} h-4 w-4`} aria-hidden="true" /> {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{usd(value)}</p>
      <p className="mt-1 text-xs opacity-75">{note}</p>
    </div>
  );
}

/** Same street address (names and phone aside)? */
function sameAddress(a: Address, b: Address | null) {
  if (!b) return false;
  const k = (x: Address) => [x.address1, x.address2 ?? "", x.city, x.state, x.postcode].map((v) => v.trim().toLowerCase()).join("|");
  return k(a) === k(b);
}
