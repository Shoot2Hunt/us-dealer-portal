"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { requestAccess } from "../actions";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
/** Matches MAX_LICENSE_FILE_BYTES in src/lib/license-docs.ts (checked again on the server). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function RequestAccessForm({ brands }: { brands: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(requestAccess, undefined);
  const [fileError, setFileError] = useState<string | null>(null);

  function checkSize(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.size > MAX_FILE_BYTES) {
      e.target.value = "";
      setFileError(`"${file.name}" is larger than 2MB. Please choose a smaller file or a lower-resolution scan.`);
    } else {
      setFileError(null);
    }
  }

  if (state?.ok) {
    return (
      <div className="mt-5 space-y-2 rounded-md bg-panel p-4 text-sm">
        <p>Thanks — your request was sent. You&apos;ll get an email with a link to set your password once it&apos;s approved.</p>
        {state.notice && <p className="text-muted">{state.notice}</p>}
      </div>
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
          <input className="input" id="name" name="name" required minLength={2} maxLength={100} autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone</label>
          <input className="input" id="phone" name="phone" type="tel" maxLength={40} autoComplete="tel" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" required maxLength={200} autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="company">Business name</label>
        <input className="input" id="company" name="company" required minLength={2} maxLength={120} autoComplete="organization" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="fflNumber">FFL number</label>
          <input className="input" id="fflNumber" name="fflNumber" required minLength={5} maxLength={40} pattern="[A-Za-z0-9 -]+" title="Letters, numbers and dashes" />
        </div>
        <div>
          <label className="label" htmlFor="fflExpires">FFL expires</label>
          <input className="input" id="fflExpires" name="fflExpires" type="date" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="hasSot" /> I hold a current SOT
      </label>
      <fieldset className="space-y-3 rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-medium">License copies (optional)</legend>
        <p className="text-xs text-muted">
          Upload a copy of your FFL and, if you have one, your SOT to speed up approval. PDF, JPG, PNG or WebP, up to 2MB each.
          Only the brand&apos;s admins and you can see them.
        </p>
        <div>
          <label className="label" htmlFor="fflFile">FFL copy</label>
          <input className="input" id="fflFile" name="fflFile" type="file" accept={ACCEPT} onChange={checkSize} />
        </div>
        <div>
          <label className="label" htmlFor="sotFile">SOT copy</label>
          <input className="input" id="sotFile" name="sotFile" type="file" accept={ACCEPT} onChange={checkSize} />
        </div>
        {fileError && <p className="text-sm text-red-700">{fileError}</p>}
      </fieldset>
      <div>
        <label className="label" htmlFor="message">Anything else? (optional)</label>
        <textarea className="input" id="message" name="message" rows={3} maxLength={2000} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="sendCopy" defaultChecked /> Email me a copy of this request
      </label>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Sending…" : "Send request"}</button>
    </form>
  );
}
