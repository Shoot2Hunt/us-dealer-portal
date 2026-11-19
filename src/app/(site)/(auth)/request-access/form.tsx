"use client";

import { useActionState } from "react";
import { requestAccess } from "../actions";

export function RequestAccessForm({ brands }: { brands: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(requestAccess, undefined);
  if (state?.ok) {
    return (
      <p className="mt-5 rounded-md bg-panel p-4 text-sm">
        Thanks — your request was sent. You&apos;ll get an email with a link to set your password once it&apos;s approved.
      </p>
    );
  }
  return (
    <form action={action} className="mt-5 space-y-4">
      <div>
        <label className="label" htmlFor="brandSlug">Brand you work with</label>
        <select className="input" id="brandSlug" name="brandSlug" required defaultValue="">
          <option value="" disabled>Choose a brand</option>
          {brands.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" required />
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone</label>
          <input className="input" id="phone" name="phone" type="tel" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" required />
      </div>
      <div>
        <label className="label" htmlFor="company">Business name</label>
        <input className="input" id="company" name="company" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="fflNumber">FFL number</label>
          <input className="input" id="fflNumber" name="fflNumber" required />
        </div>
        <div>
          <label className="label" htmlFor="fflExpires">FFL expires</label>
          <input className="input" id="fflExpires" name="fflExpires" type="date" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="hasSot" /> I hold a current SOT
      </label>
      <div>
        <label className="label" htmlFor="message">Anything else? (optional)</label>
        <textarea className="input" id="message" name="message" rows={3} />
      </div>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Sending…" : "Send request"}</button>
    </form>
  );
}
