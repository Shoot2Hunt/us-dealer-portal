"use client";

import { startTransition, useActionState, useState } from "react";
import type { Address } from "@/lib/db/schema";
import { PhoneInput } from "@/components/phone-input";
import { saveBillingDetails } from "./actions";

type Method = "card" | "ach" | "check" | "terms";

export type BillingDetailsProps = {
  /** The saved billing address, or null when billing goes to the shipping address. */
  billingAddress: Address | null;
  shippingAddress: Address | null;
  loginEmail: string;
  billingEmail: string | null;
  preferred: Method | null;
  /** Methods this dealer can use right now, with their labels. */
  methods: { value: Method; label: string }[];
};

const ADDRESS_FIELDS: { key: keyof Address; label: string; auto: string; wide?: boolean; optional?: boolean; props?: React.InputHTMLAttributes<HTMLInputElement> }[] = [
  { key: "firstName", label: "First name", auto: "billing given-name", props: { maxLength: 60 } },
  { key: "lastName", label: "Last name", auto: "billing family-name", props: { maxLength: 60 } },
  { key: "company", label: "Business name", auto: "billing organization", wide: true, optional: true, props: { maxLength: 120 } },
  { key: "address1", label: "Street address", auto: "billing address-line1", wide: true, props: { maxLength: 120 } },
  { key: "address2", label: "Apt, suite, unit", auto: "billing address-line2", wide: true, optional: true, props: { maxLength: 120 } },
  { key: "city", label: "City", auto: "billing address-level2", props: { maxLength: 80 } },
  {
    key: "state", label: "State", auto: "billing address-level1",
    props: { minLength: 2, maxLength: 2, pattern: "[A-Za-z]{2}", title: "2-letter state code, e.g. ID", placeholder: "ID", className: "input uppercase" },
  },
  {
    key: "postcode", label: "ZIP code", auto: "billing postal-code",
    props: { pattern: "[0-9]{5}(-[0-9]{4})?", title: "5-digit ZIP code, e.g. 83814", inputMode: "numeric", maxLength: 10 },
  },
];

const oneLine = (a: Address) => [a.company, `${a.firstName} ${a.lastName}`, a.address1, a.address2, `${a.city}, ${a.state} ${a.postcode}`].filter(Boolean).join(" · ");

/** Billing name and address, billing email and preferred payment method (Billing page). */
export function BillingDetails({ billingAddress, shippingAddress, loginEmail, billingEmail, preferred, methods }: BillingDetailsProps) {
  const [state, action, pending] = useActionState(saveBillingDetails, undefined);
  const [same, setSame] = useState(billingAddress === null && shippingAddress !== null);
  const start = billingAddress ?? shippingAddress;
  const [phone, setPhone] = useState(start?.phone ?? "");

  return (
    <form
      className="card space-y-6 text-sm"
      // Submitted by hand: <form action> would clear what was typed if saving fails.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="icon-[lucide--building-2] h-5 w-5 text-accent" aria-hidden="true" /> Billing details
          </h2>
          <p className="mt-0.5 text-muted">Used for invoices, receipts and card payments. Each brand&apos;s order is billed to this address.</p>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-medium">Billing address</legend>
        <label className={`flex items-center gap-2 ${shippingAddress ? "" : "text-muted"}`}>
          <input type="checkbox" name="sameAsShipping" checked={same} disabled={!shippingAddress} onChange={(e) => setSame(e.target.checked)} />
          Same as my shipping address
          {!shippingAddress && <span className="text-xs">(add one on your Account page first)</span>}
        </label>
        {same && shippingAddress ? (
          <p className="rounded-md bg-panel px-3 py-2 text-muted">{oneLine(shippingAddress)}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {ADDRESS_FIELDS.map(({ key, label, auto, wide, optional, props }) => (
              <div key={key} className={wide ? "sm:col-span-2" : ""}>
                <label className="label" htmlFor={`bill_${key}`}>
                  {label} {optional && <span className="font-normal text-muted">(optional)</span>}
                </label>
                <input className="input" id={`bill_${key}`} name={key} defaultValue={start?.[key] ?? ""} autoComplete={auto} required={!optional} {...props} />
              </div>
            ))}
            <div>
              <label className="label" htmlFor="bill_phone">Billing phone <span className="font-normal text-muted">(optional)</span></label>
              <PhoneInput id="bill_phone" name="phone" value={phone} onChange={setPhone} autoComplete="billing tel" />
            </div>
          </div>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="billingEmail">Billing email <span className="font-normal text-muted">(optional)</span></label>
          <input className="input" id="billingEmail" name="billingEmail" type="email" maxLength={200} defaultValue={billingEmail ?? ""} placeholder="e.g. ap@yourstore.com" autoComplete="billing email" />
          <p className="mt-1 text-xs text-muted">Receipts go here as well as to {loginEmail}.</p>
        </div>
        <div>
          <label className="label" htmlFor="preferredPaymentMethod">Preferred payment method</label>
          <select className="input" id="preferredPaymentMethod" name="preferredPaymentMethod" defaultValue={preferred && methods.some((m) => m.value === preferred) ? preferred : ""}>
            <option value="">No preference</option>
            {methods.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">Chosen for you at checkout. You can still pick another each time.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save billing details"}</button>
        {state?.error && <p role="alert" className="text-red-700">{state.error}</p>}
        {state?.ok && <p role="status" className="flex items-center gap-1 text-green-700"><span className="icon-[lucide--circle-check] h-4 w-4" aria-hidden="true" /> {state.message}</p>}
      </div>
    </form>
  );
}
