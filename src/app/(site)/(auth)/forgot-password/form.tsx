"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "../actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  if (state?.ok) {
    return (
      <p className="mt-5 rounded-md bg-panel p-4 text-sm">
        If that email belongs to an active account, a reset link is on its way. It expires in 1 hour. Check your spam folder if you
        don&apos;t see it in a few minutes.
      </p>
    );
  }
  return (
    <form action={action} className="mt-5 space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Sending…" : "Email me a reset link"}</button>
    </form>
  );
}
