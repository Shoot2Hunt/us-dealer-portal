"use client";

import { ErrorView } from "@/components/error-view";

/** Errors in the sign-in pages, or in the portal layout itself (e.g. the database is unreachable). */
export default function SiteError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-panel px-4">
      <div className="card w-full max-w-md shadow-sm">
        <ErrorView error={error} retry={retry} />
      </div>
    </main>
  );
}
