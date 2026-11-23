import "server-only";
import { createClient, type SanityClient } from "next-sanity";
import { apiVersion, dataset, projectId } from "./env";

/**
 * Sanity client that can create documents (contact messages). Needs SANITY_API_WRITE_TOKEN,
 * an "Editor" token from sanity.io/manage → API → Tokens. Returns null when not configured.
 */
export function sanityWriter(): SanityClient | null {
  const token = process.env.SANITY_API_WRITE_TOKEN;
  if (!token || projectId === "replaceme") return null;
  return createClient({ projectId, dataset, apiVersion, token, useCdn: false });
}
