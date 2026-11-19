"use client";

import { useActionState } from "react";
import { setPassword } from "../actions";

export function SetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(setPassword, undefined);
  return (
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="password">New password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      <div>
        <label className="label" htmlFor="confirm">Confirm password</label>
        <input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Saving…" : "Save and sign in"}</button>
    </form>
  );
}
