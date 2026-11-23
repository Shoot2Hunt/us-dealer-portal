"use client";

import { useState } from "react";

/** A discount code dealers can copy with one click. */
export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="group inline-flex items-center gap-2 rounded-md border-2 border-dashed border-accent/50 bg-accent-soft px-3 py-1.5 font-mono text-sm font-bold tracking-wider text-accent-dark transition hover:border-accent hover:bg-accent hover:text-white"
      title="Copy code"
    >
      {code}
      {copied ? (
        <span key="ok" className="icon-[lucide--check] h-4 w-4 animate-pop-in" aria-hidden="true" />
      ) : (
        <span key="copy" className="icon-[lucide--copy] h-4 w-4 opacity-70 group-hover:opacity-100" aria-hidden="true" />
      )}
      <span className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</span>
    </button>
  );
}
