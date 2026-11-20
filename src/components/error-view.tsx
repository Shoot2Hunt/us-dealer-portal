"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Shared fallback for error.tsx boundaries. In production, server errors arrive
 * without their message (Next.js hides it) but with a digest that matches the
 * server log entry, so we show that as a reference code.
 */
export function ErrorView({ error, retry, title = "Something went wrong" }: { error: unknown; retry: () => void; title?: string }) {
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md space-y-3 py-12 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted">
        This page didn&apos;t load properly. It&apos;s usually temporary, so please try again. If it keeps happening, contact support
        {digest ? " and mention the reference below" : ""}.
      </p>
      {digest && <p className="font-mono text-xs text-muted">Reference: {digest}</p>}
      <div className="flex justify-center gap-2 pt-2">
        <button onClick={() => retry()} className="btn">Try again</button>
        <Link href="/" className="btn-ghost">Go to home</Link>
      </div>
    </div>
  );
}
