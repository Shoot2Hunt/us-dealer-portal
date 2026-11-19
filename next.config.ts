import type { NextConfig } from "next";

// Cache Components is off on purpose: almost every page in the portal is
// per-dealer and session-gated, so the classic dynamic rendering model is simpler.
const nextConfig: NextConfig = {
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
