"use client";

import { startTransition, useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { requestAccess } from "../actions";
import { PhoneInput } from "@/components/phone-input";
import { FileField, type UploadedFile } from "@/components/file-field";
import { EXPIRY_LIMITS, expiryProblem, type LicenseKind } from "@/lib/license-dates";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
/**
 * Matches MAX_LICENSE_FILE_BYTES in src/lib/license-docs.ts (checked again on the server).
 * Each file uploads on its own request, and Vercel caps a request at 4.5MB, so 4MB is the most.
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

type Fields = {
  brandSlug: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  fflNumber: string;
  fflExpires: string;
  sotNumber: string;
  sotExpires: string;
  sendCopy: boolean;
};
const EMPTY: Fields = { brandSlug: "", name: "", phone: "", email: "", company: "", fflNumber: "", fflExpires: "", sotNumber: "", sotExpires: "", sendCopy: true };
type Files = { fflFile: UploadedFile | null; sotFile: UploadedFile | null };

// --- Draft: survives a refresh, gone when the tab is closed or the request is sent. ---
// Files are already uploaded by then, so the draft only needs their ids and names.
const DRAFT_KEY = "request-access-draft";
type Draft = Partial<Fields> & { files?: Partial<Files> };
const clearDraft = () => {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
};

export function RequestAccessForm({ brands }: { brands: { value: string; label: string }[] }) {
  const [state, dispatch, pending] = useActionState(requestAccess, undefined);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [files, setFiles] = useState<Files>({ fflFile: null, sotFile: null });
  const [fileErrors, setFileErrors] = useState<Partial<Record<keyof Files, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<LicenseKind, boolean>>>({});
  const restored = useRef(false);

  // Restore the draft after a refresh. Runs once, in the browser only.
  useEffect(() => {
    let draft: Draft | null = null;
    try {
      draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
    } catch {}
    if (draft) {
      const { files: savedFiles, ...savedFields } = draft;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage only exists in the browser, after hydration
      setFields((f) => ({ ...f, ...savedFields }));
      setFiles((f) => ({ fflFile: f.fflFile ?? savedFiles?.fflFile ?? null, sotFile: f.sotFile ?? savedFiles?.sotFile ?? null }));
    }
    restored.current = true;
  }, []);

  // Save as they type and upload.
  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...fields, files } satisfies Draft));
    } catch {}
  }, [fields, files]);

  useEffect(() => {
    if (state?.ok) clearDraft();
  }, [state]);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((f) => ({ ...f, [key]: value }));
  const setFile = (key: keyof Files) => (file: UploadedFile | null) => {
    setFiles((f) => ({ ...f, [key]: file }));
    setFileErrors((e) => ({ ...e, [key]: undefined }));
  };

  function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    // Submitted by hand rather than with <form action>, which would clear every field
    // whenever the server sends back an error.
    e.preventDefault();
    const missing: Partial<Record<keyof Files, string>> = {};
    if (!files.fflFile) missing.fflFile = "Upload a copy of your FFL.";
    if (!files.sotFile) missing.sotFile = "Upload a copy of your SOT.";
    if (missing.fflFile || missing.sotFile) {
      setFileErrors(missing);
      return;
    }
    const data = new FormData(e.currentTarget);
    data.set("fflUploadId", files.fflFile!.id);
    data.set("sotUploadId", files.sotFile!.id);
    startTransition(() => dispatch(data));
  }

  if (state?.ok) {
    return (
      <div className="mt-5 space-y-2 rounded-md bg-panel p-4 text-sm">
        <p>Thanks — your request was sent. You&apos;ll get an email with a link to set your password once it&apos;s approved.</p>
        {state.notice && <p className="text-muted">{state.notice}</p>}
      </div>
    );
  }

  const text = (key: keyof Fields) => ({
    id: key,
    name: key,
    value: fields[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value),
  });

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <div>
        <label className="label" htmlFor="brandSlug">Brand you work with</label>
        <select className="input" id="brandSlug" name="brandSlug" required value={fields.brandSlug} onChange={(e) => set("brandSlug", e.target.value)}>
          <option value="" disabled>Choose a brand</option>
          {brands.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input className="input" {...text("name")} required minLength={2} maxLength={100} autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone</label>
          <PhoneInput id="phone" name="phone" value={fields.phone} onChange={(v) => set("phone", v)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" {...text("email")} type="email" required maxLength={200} autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="company">Business name</label>
        <input className="input" {...text("company")} required minLength={2} maxLength={120} autoComplete="organization" />
      </div>

      {(["ffl", "sot"] as const).map((kind) => {
        const KIND = kind.toUpperCase();
        const numberKey = `${kind}Number` as const;
        const expiresKey = `${kind}Expires` as const;
        const fileKey = `${kind}File` as const;
        const problem = expiryProblem(kind, fields[expiresKey], new Date(), 0);
        return (
          <section key={kind} className="space-y-3 border-t border-line pt-4">
            <h2 className="text-sm font-semibold">{KIND}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor={numberKey}>{kind === "ffl" ? "FFL number" : "SOT number / EIN"}</label>
                <input className="input" {...text(numberKey)} required minLength={5} maxLength={40} pattern="[A-Za-z0-9 -]+" title="Letters, numbers and dashes" />
              </div>
              <div>
                <label className="label" htmlFor={expiresKey}>{KIND} expires</label>
                <ExpiryInput
                  id={expiresKey}
                  value={fields[expiresKey]}
                  onChange={(v) => set(expiresKey, v)}
                  problem={problem}
                  showProblem={Boolean(touched[kind])}
                  onBlur={() => setTouched((t) => ({ ...t, [kind]: true }))}
                  maxYears={EXPIRY_LIMITS[kind].maxYears}
                />
              </div>
            </div>
            <FileField
              id={fileKey}
              label={`${KIND} copy`}
              kind={kind}
              value={files[fileKey]}
              onChange={setFile(fileKey)}
              accept={ACCEPT}
              maxBytes={MAX_FILE_BYTES}
              hint="PDF, JPG, PNG or WebP, up to 4MB."
              error={fileErrors[fileKey]}
            />
          </section>
        );
      })}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="sendCopy" checked={fields.sendCopy} onChange={(e) => set("sendCopy", e.target.checked)} /> Email me a copy of this request
      </label>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Sending…" : "Send request"}</button>
    </form>
  );
}

const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Today on the visitor's own calendar. Null while rendering on the server, whose clock is UTC. */
const useToday = () => useSyncExternalStore(noopSubscribe, () => isoLocal(new Date()), () => null);
const noopSubscribe = () => () => {};

/**
 * A date field for an expiry date. Checked as it's typed: a date before today is cleared
 * straight away (the calendar greys those days out too), and an unreal or too-distant date
 * is explained under the field and blocks submitting.
 */
function ExpiryInput({
  id,
  value,
  onChange,
  problem,
  showProblem,
  onBlur,
  maxYears,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  problem: string | null;
  showProblem: boolean;
  onBlur: () => void;
  maxYears: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const today = useToday();
  const [rejected, setRejected] = useState<string | null>(null);
  useEffect(() => {
    ref.current?.setCustomValidity(problem ?? "");
  }, [problem]);

  const max = today ? (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setFullYear(d.getFullYear() + maxYears);
    return isoLocal(d);
  })() : undefined;
  // Browsers report each keystroke of the year ("0002", "0020", "0202"...), so a date only
  // counts as entered once its year has 4 real digits.
  const complete = (v: string) => /^[1-9]\d{3}-\d{2}-\d{2}$/.test(v);
  const pretty = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const message = rejected ?? ((showProblem || complete(value)) && problem ? problem : null);
  return (
    <>
      <input
        ref={ref}
        className={`input ${message ? "border-red-400" : ""}`}
        id={id}
        name={id}
        type="date"
        required
        // min/max grey out past and far-off days in the calendar, and stop 5- or 6-digit years.
        min={today ?? undefined}
        max={max}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (today && complete(v) && v < today) {
            setRejected(`The expiry date can't be before today (${pretty(today)}).`);
            onChange("");
            return;
          }
          setRejected(null);
          onChange(v);
        }}
        onBlur={onBlur}
        onInvalid={onBlur}
        aria-invalid={Boolean(message)}
      />
      {message && <p role="alert" className="mt-1 text-xs text-red-700">{message}</p>}
    </>
  );
}
