"use client";

import { ViewTransition } from "react";
import { usePathname } from "next/navigation";

/**
 * Animates page content between routes with the browser's View Transitions API.
 * Keyed by pathname, so the old page exits and the new one enters on every navigation,
 * while filter/search changes on the same page (query string only) never animate.
 *
 * Links tagged `transitionTypes={["nav-forward"]}` / `["nav-back"]` slide in that
 * direction; everything else (menu links, browser back) gets a soft fade-and-rise.
 * Browsers without view transitions simply swap pages as before.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const types = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-fade" };
  return (
    <ViewTransition key={pathname} enter={types} exit={types} default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
