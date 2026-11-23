import type { NextConfig } from "next";

/**
 * Security headers on every response.
 * - frame-ancestors / X-Frame-Options: no clickjacking (the portal is never framed).
 * - base-uri / object-src / form-action: block <base> hijacking, plugins, and forms
 *   posting off-site. A full script-src CSP is not set: Next's inline scripts, Accept.js,
 *   Sanity Studio and the optional analytics plugins would each need allow-listing.
 * - HSTS: browsers only ever use HTTPS for this site after the first visit.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Cache Components is off on purpose: almost every page in the portal is
// per-dealer and session-gated, so the classic dynamic rendering model is simpler.
const nextConfig: NextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // FFL/SOT previews are shown in an iframe on the portal's own pages (a later rule wins
      // for the same header key). Files there are already limited to real PDFs/images.
      {
        source: "/api/license-documents/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'none'; form-action 'none'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
  experimental: {
    // Dealers can attach an FFL and an SOT copy (2MB each) when requesting access.
    // Keep this under Vercel's 4.5MB request body limit.
    serverActions: { bodySizeLimit: "4.4mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Only Sanity's CDN. (A "**" wildcard would let anyone use the image optimizer as a proxy.)
    remotePatterns: [{ protocol: "https", hostname: "cdn.sanity.io" }],
  },
};

export default nextConfig;
