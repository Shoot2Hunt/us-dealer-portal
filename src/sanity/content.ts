import "server-only";
import { createClient } from "next-sanity";
import { apiVersion, dataset, projectId } from "./env";

export const sanity = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: true,
  token: process.env.SANITY_API_READ_TOKEN || undefined,
});

/** Admin edits in the Studio show up in the portal within this many seconds. */
const REVALIDATE = 30;

async function q<T>(query: string, params: Record<string, unknown> = {}): Promise<T> {
  if (projectId === "replaceme") return null as T;
  try {
    return await sanity.fetch<T>(query, params, { next: { revalidate: REVALIDATE, tags: ["sanity"] } });
  } catch (err) {
    console.error("Sanity fetch failed", err);
    return null as T;
  }
}

export type SiteSettings = {
  portalName?: string;
  logoUrl?: string;
  loginMessage?: string;
  requestAccessIntro?: string;
  welcomeMessage?: string;
  supportEmail?: string;
  supportPhone?: string;
};

export type PaymentSettings = {
  enableCard: boolean;
  enableAch: boolean;
  enableCheck: boolean;
  allowSplit: boolean;
  maxSplitParts: number;
  checkPayableTo?: string;
  checkMailingAddress?: string;
  checkoutNote?: string;
};

export type ShippingRestriction = { categorySlug?: string; states?: string[]; message?: string };

export type Brand = {
  name: string;
  storeKey: string;
  active: boolean;
  logoUrl?: string;
  description?: string;
  notificationEmails?: string[];
  dealerDiscountPercent?: number;
  sotRequiredCategories?: string[];
  shippingRestrictions?: ShippingRestriction[];
};

export type ProductOverride = {
  storeKey: string;
  sku: string;
  hidden?: boolean;
  dealerPrice?: number;
  minQuantity?: number;
  featured?: boolean;
  dealerNote?: string;
};

export type Announcement = { _id: string; title: string; body?: string };
export type Page = { title: string; slug: string; body?: unknown[] };

export async function getSiteSettings(): Promise<SiteSettings> {
  return (
    (await q<SiteSettings>(`*[_id == "siteSettings"][0]{portalName, "logoUrl": logo.asset->url, loginMessage, requestAccessIntro, welcomeMessage, supportEmail, supportPhone}`)) ?? {}
  );
}

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const s = await q<Partial<PaymentSettings> | null>(`*[_id == "paymentSettings"][0]`);
  return {
    enableCard: s?.enableCard ?? true,
    enableAch: s?.enableAch ?? true,
    enableCheck: s?.enableCheck ?? true,
    allowSplit: s?.allowSplit ?? true,
    maxSplitParts: s?.maxSplitParts ?? 3,
    checkPayableTo: s?.checkPayableTo,
    checkMailingAddress: s?.checkMailingAddress,
    checkoutNote: s?.checkoutNote,
  };
}

export async function getBrands(): Promise<Brand[]> {
  return (
    (await q<Brand[]>(
      `*[_type == "brand"] | order(sortOrder asc){name, storeKey, "active": coalesce(active, true), "logoUrl": logo.asset->url, description, notificationEmails, dealerDiscountPercent, sotRequiredCategories, shippingRestrictions[]{categorySlug, states, message}}`,
    )) ?? []
  );
}

export async function getProductOverrides(): Promise<ProductOverride[]> {
  return (
    (await q<ProductOverride[]>(
      `*[_type == "productOverride"]{"storeKey": brand->storeKey, sku, hidden, dealerPrice, minQuantity, featured, dealerNote}`,
    )) ?? []
  );
}

export async function getAnnouncements(): Promise<Announcement[]> {
  return (
    (await q<Announcement[]>(
      `*[_type == "announcement" && active == true && (!defined(startsAt) || startsAt <= now()) && (!defined(endsAt) || endsAt > now())] | order(_createdAt desc){_id, title, body}`,
    )) ?? []
  );
}

export async function getNavPages(): Promise<{ title: string; slug: string }[]> {
  return (await q<{ title: string; slug: string }[]>(`*[_type == "page" && showInNav == true]{title, "slug": slug.current}`)) ?? [];
}

export async function getPage(slug: string): Promise<Page | null> {
  return q<Page | null>(`*[_type == "page" && slug.current == $slug][0]{title, "slug": slug.current, body}`, { slug });
}
