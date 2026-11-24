"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Address } from "@/lib/db/schema";
import { PhoneInput } from "@/components/phone-input";
import {
  beginTwoFactorSetup,
  cancelTwoFactorSetup,
  changePassword,
  confirmTwoFactorSetup,
  disableTwoFactor,
  regenerateRecoveryCodes,
  signOutEverywhere,
  updateProfile,
  type AccountState,
} from "./actions";

function Result({ state }: { state: AccountState }) {
  if (state?.error) return <p className="text-sm text-red-700" role="alert">{state.error}</p>;
  if (state?.message) return <p className="text-sm text-green-700" role="status">{state.message}</p>;
  return null;
}

function Submit({ children, pendingText, className = "btn" }: { children: React.ReactNode; pendingText: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending}>{pending ? pendingText : children}</button>;
}

// --- Profile ---

const ADDRESS_FIELDS: [keyof Address, string, string?][] = [
  ["firstName", "First name", "given-name"],
  ["lastName", "Last name", "family-name"],
  ["company", "Company", "organization"],
  ["phone", "Phone", "tel"],
  ["address1", "Street address", "address-line1"],
  ["address2", "Apt, suite, unit", "address-line2"],
  ["city", "City", "address-level2"],
  ["state", "State", "address-level1"],
  ["postcode", "ZIP code", "postal-code"],
];

/** `address` is undefined for admins (no shipping), null for a dealer with none saved. */
export function ProfileForm({ name, phone, address }: { name: string; phone: string; address: Address | null | undefined }) {
  const [state, action] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="card space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" defaultValue={name} autoComplete="name" required />
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone</label>
          <PhoneInput id="phone" name="phone" defaultValue={phone} />
        </div>
      </div>
      {address !== undefined && (
        <fieldset className="space-y-2">
          <legend className="font-medium">Default shipping address</legend>
          <p className="text-xs text-muted">Filled in for you at checkout. You can still change it on each order.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {ADDRESS_FIELDS.map(([key, label, autoComplete]) => (
              <div key={key} className={key === "address1" ? "sm:col-span-2" : ""}>
                <label className="label" htmlFor={`ship_${key}`}>{label}</label>
                {key === "phone" ? (
                  <PhoneInput id="ship_phone" name="ship_phone" defaultValue={address?.phone ?? ""} autoComplete="shipping tel" />
                ) : (
                  <input className="input" id={`ship_${key}`} name={`ship_${key}`} defaultValue={address?.[key] ?? ""} autoComplete={`shipping ${autoComplete}`} />
                )}
              </div>
            ))}
          </div>
        </fieldset>
      )}
      <Result state={state} />
      <Submit pendingText="Saving…">Save profile</Submit>
    </form>
  );
}

// --- Password ---

export function PasswordForm() {
  const [state, action] = useActionState(changePassword, undefined);
  return (
    // key resets the inputs after a successful change
    <form key={state?.ok ? "done" : "form"} action={action} className="card grid gap-3 text-sm sm:grid-cols-3">
      <div>
        <label className="label" htmlFor="current">Current password</label>
        <input className="input" id="current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div>
        <label className="label" htmlFor="password">New password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      <div>
        <label className="label" htmlFor="confirm">Confirm new password</label>
        <input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <div className="space-y-3 sm:col-span-3">
        <Result state={state} />
        <Submit pendingText="Changing…">Change password</Submit>
      </div>
    </form>
  );
}

// --- Two-step verification ---

/**
 * One component for every 2FA state, so the recovery codes shown right after
 * turning it on stay on screen when the page refreshes underneath.
 */
export function TwoFactorPanel(p: {
  enabled: boolean;
  enabledOn: string | null;
  codesLeft: number;
  setup: { qr: string; secret: string } | null;
}) {
  const [confirmState, confirmAction] = useActionState(confirmTwoFactorSetup, undefined);
  const [regenState, regenAction] = useActionState(regenerateRecoveryCodes, undefined);
  const [disableState, disableAction] = useActionState(disableTwoFactor, undefined);
  const [showDisable, setShowDisable] = useState(false);
  const codes = p.enabled ? (regenState?.codes ?? confirmState?.codes) : undefined;

  if (p.enabled) {
    return (
      <div className="card space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge bg-green-100 text-green-800">On</span>
          <span className="text-muted">
            Since {p.enabledOn}. {p.codesLeft} of 10 recovery codes left.
          </span>
        </div>

        {codes && <RecoveryCodes codes={codes} message={(regenState?.codes ? regenState : confirmState)?.message} />}
        {!codes && p.codesLeft <= 3 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">You&apos;re running low on recovery codes. Create a new set below.</p>
        )}

        <form action={regenAction} className="space-y-2 border-t border-line pt-4">
          <p className="font-medium">New recovery codes</p>
          <p className="text-muted">Lost your codes or used most of them? Make a new set. The old ones stop working.</p>
          <div className="flex flex-wrap gap-2">
            <CodeInput name="code" className="max-w-40" />
            <Submit className="btn-ghost" pendingText="Creating…">Create new codes</Submit>
          </div>
          {!regenState?.codes && <Result state={regenState} />}
        </form>

        <div className="space-y-2 border-t border-line pt-4">
          <p className="font-medium">Turn off</p>
          {!showDisable ? (
            <button type="button" className="btn-ghost text-red-700" onClick={() => setShowDisable(true)}>Turn off two-step verification</button>
          ) : (
            <form action={disableAction} className="space-y-2">
              <p className="text-muted">Confirm with your password and a current code. Your account will be protected by your password only.</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
                <input className="input" name="password" type="password" placeholder="Password" autoComplete="current-password" required />
                <CodeInput name="code" />
                <Submit className="btn-ghost text-red-700" pendingText="Turning off…">Turn off</Submit>
              </div>
              <Result state={disableState} />
            </form>
          )}
        </div>
      </div>
    );
  }

  if (p.setup) {
    return (
      <div className="card space-y-4 text-sm">
        <ol className="list-decimal space-y-4 pl-5">
          <li>
            <p className="font-medium">Scan this QR code with your authenticator app.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="mt-2 rounded border border-line" />
            <p className="mt-2 text-muted">
              Can&apos;t scan it? Enter this key in the app instead:{" "}
              <code className="select-all rounded bg-panel px-1.5 py-0.5 font-mono text-ink">{p.setup.secret}</code>
            </p>
          </li>
          <li>
            <form action={confirmAction} className="space-y-2">
              <label className="font-medium" htmlFor="setup-code">Enter the 6-digit code the app shows.</label>
              <div className="flex flex-wrap gap-2">
                <CodeInput id="setup-code" name="code" className="max-w-40" autoFocus />
                <Submit pendingText="Checking…">Turn on</Submit>
              </div>
              <Result state={confirmState} />
            </form>
          </li>
        </ol>
        <form action={cancelTwoFactorSetup}>
          <Submit className="text-muted hover:text-ink" pendingText="Cancelling…">Cancel setup</Submit>
        </form>
      </div>
    );
  }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="badge bg-panel text-muted">Off</span>
        <span className="text-muted">{disableState?.message ?? "Your account is protected by your password only."}</span>
      </div>
      <form action={beginTwoFactorSetup}>
        <Submit pendingText="Starting…">Set up two-step verification</Submit>
      </form>
    </div>
  );
}

function CodeInput({ className = "", ...rest }: { name: string; id?: string; className?: string; autoFocus?: boolean }) {
  return (
    <input
      {...rest}
      className={`input font-mono tracking-widest ${className}`}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      maxLength={20}
      required
    />
  );
}

/** Shown once, right after they're created. Only hashes are stored. */
function RecoveryCodes({ codes, message }: { codes: string[]; message?: string }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Dealer portal recovery codes\nEach code works once.\n\n${text}\n`], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "dealer-portal-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3 rounded-md border border-accent/40 bg-accent/5 p-4">
      {message && <p className="font-medium text-green-700">{message}</p>}
      <p>
        <span className="font-medium">Save these recovery codes now.</span> Each one gets you in once if you lose your phone.
        This is the only time they&apos;ll be shown.
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono sm:grid-cols-5">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn-ghost" onClick={download}>Download .txt</button>
      </div>
    </div>
  );
}

// --- Sessions ---

export function SignOutEverywhereButton() {
  const [done, setDone] = useState(false);
  return (
    <form
      action={async () => {
        await signOutEverywhere();
        setDone(true);
      }}
      className="flex flex-wrap items-center gap-3 text-sm"
    >
      <Submit className="btn-ghost" pendingText="Signing out…">Sign out of all other devices</Submit>
      {done && <span className="text-green-700" role="status">Done. Every other device has been signed out.</span>}
    </form>
  );
}
