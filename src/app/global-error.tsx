"use client";

/**
 * Last-resort fallback when the root layout itself fails. It replaces the whole
 * document, so global CSS isn't loaded: styles are inline.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f7f8", color: "#16181d" }}>
        <title>Something went wrong</title>
        <main style={{ maxWidth: 420, margin: "15vh auto", padding: 24, background: "#fff", border: "1px solid #e3e5e8", borderRadius: 8, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#646a75" }}>The portal couldn&apos;t load. Please try again in a minute.</p>
          {digest && <p style={{ fontSize: 12, color: "#646a75", fontFamily: "monospace" }}>Reference: {digest}</p>}
          <button onClick={() => retry()} style={{ marginTop: 8, padding: "8px 16px", borderRadius: 6, border: 0, background: "#16181d", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
