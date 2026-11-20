"use client";

import { ErrorView } from "@/components/error-view";

/** Errors inside portal pages. The portal header stays visible above this. */
export default function PortalError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}
