import type { NextConfig } from "next";

// Cache Components is off on purpose: almost every page in the portal is
// per-dealer and session-gated, so the classic dynamic rendering model is simpler.
const nextConfig: NextConfig = {
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
    remotePatterns: [
      { protocol: "https", hostname: "cdn.sanity.io" },
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
