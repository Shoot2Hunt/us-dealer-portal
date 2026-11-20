"use client";

import { useActionState } from "react";
import { verifyLogin } from "../../actions";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyLogin, undefined);
  return (
    <form action={action} className="mt-5 space-y-4">
      <div>
        <label className="label" htmlFor="code">Code</label>
        <input
          className="input text-center font-mono text-lg tracking-[0.3em]"
          id="code"
          name="code"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={20}
          placeholder="123456"
        />
      </div>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Checking…" : "Verify and sign in"}</button>
    </form>
  );
}
