/**
 * Policy pages linked from the footer. Each is a Sanity "Page" with this slug, served
 * publicly at /legal/<slug> (other Sanity pages stay dealer-only under /p/<slug>).
 */
export const LEGAL_PAGES = [
  { slug: "terms-and-conditions", title: "Terms & Conditions" },
  { slug: "privacy-policy", title: "Privacy Policy" },
  { slug: "return-policy", title: "Return Policy" },
] as const;

export function legalPage(slug: string) {
  return LEGAL_PAGES.find((p) => p.slug === slug);
}
