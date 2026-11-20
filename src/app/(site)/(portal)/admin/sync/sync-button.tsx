"use client";

import { useActionState, useEffect, useState } from "react";
import { runSync } from "../actions";

/** "Run full sync now" with a live indicator while the sync runs and a result line afterwards. */
export function SyncButton({ store, storeName }: { store: string; storeName: string }) {
  const [result, action, pending] = useActionState(runSync, undefined);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);

  // Tick once a second while syncing so the elapsed time updates.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pending]);

  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <form
      action={action}
      onSubmit={() => {
        const t = Date.now();
        setStartedAt(t);
        setNow(t);
      }}
      className="space-y-2"
    >
      <input type="hidden" name="store" value={store} />
      <button className="btn-ghost" disabled={pending} aria-busy={pending}>
        {pending && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {pending ? "Syncing…" : "Run full sync now"}
      </button>

      <div aria-live="polite">
        {pending ? (
          <div className="space-y-1.5 rounded-md bg-panel p-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full w-1/3 animate-[sync-slide_1.4s_ease-in-out_infinite] rounded-full bg-accent" />
            </div>
            <p className="text-xs text-muted">
              Pulling every product from {storeName}… {clock} elapsed. Large stores can take a few minutes. Keep this tab open.
            </p>
          </div>
        ) : result ? (
          <p className={`rounded-md p-2 text-xs ${result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            {result.ok ? "✓ " : ""}
            {result.message} {result.seconds > 0 && <span className="opacity-70">({result.seconds}s)</span>}
          </p>
        ) : null}
      </div>
    </form>
  );
}
