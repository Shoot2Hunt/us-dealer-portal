import "server-only";
import { cache } from "react";
import { createClient } from "next-sanity";
import { apiVersion, dataset, projectId } from "./env";
import type { ThemeSettings } from "@/lib/theme";

/**
 * Reads go straight to Sanity's live API, not its CDN. The CDN keeps answers for 60s+,
 * which stacked on our own cache made Studio edits look stuck until a redeploy. Our
 * cache below (REVALIDATE + the "sanity" tag) is what keeps request volume low.
 */
export const sanity = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: false,
  perspective: "published",
  token: process.env.SANITY_API_READ_TOKEN || undefined,
});

/**
 * Studio edits show up within this many seconds (one reload may still show the old
 * version while it refreshes). The /api/revalidate webhook makes it instant.
 */
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

/**
 * Every settings document in one request (shared by all getters below and de-duplicated
 * per page render), so frequent refreshes cost one Sanity API call, not seven.
 */
const settings = cache(async () =>
  (await q<{
    site: SiteSettings | null;
    payment: Partial<PaymentSettings> | null;
    theme: ThemeSettings | null;
    header: Partial<HeaderSettings> | null;
    footer: Partial<FooterSettings> | null;
    security: Partial<SecuritySettings> | null;
    plugins: { analytics?: Record<string, unknown>; cookieConsent?: Record<string, unknown>; maintenance?: Record<string, unknown> } | null;
  } | null>(`{
    "site": *[_id == "siteSettings"][0]{portalName, "logoUrl": logo.asset->url, loginMessage, requestAccessIntro, welcomeMessage, supportEmail, supportPhone},
    "payment": *[_id == "paymentSettings"][0],
    "theme": *[_id == "themeSettings"][0]{preset, customAccent, customInk, customGold, headingFont, bodyFont, corners},
    "header": *[_id == "headerSettings"][0]{showLogo, sticky, links[]{label, href, icon}, showPages, showContact},
    "footer": *[_id == "footerSettings"][0]{tagline, showBrands, brandsHeading, columns[]{title, links[]{label, href}}, showPolicies, showContact, social[]{platform, url}, copyright},
    "security": *[_id == "securitySettings"][0],
    "plugins": *[_id == "pluginSettings"][0]{analytics, cookieConsent, maintenance}
  }`)) ?? null,
);

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
  website?: string;
  footerLogoUrl?: string;
  color?: string;
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
  /** Optional window for dealerPrice; outside it the normal price applies. */
  saleStarts?: string;
  saleEnds?: string;
};

export type Announcement = { _id: string; title: string; body?: string };
export type Page = { title: string; slug: string; body?: unknown[] };

export async function getSiteSettings(): Promise<SiteSettings> {
  return (
    (await settings())?.site ?? {}
  );
}

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const s = (await settings())?.payment;
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
      `*[_type == "brand"] | order(sortOrder asc){name, storeKey, "active": coalesce(active, true), "logoUrl": logo.asset->url, "footerLogoUrl": footerLogo.asset->url, color, website, description, notificationEmails, dealerDiscountPercent, sotRequiredCategories, shippingRestrictions[]{categorySlug, states, message}}`,
    )) ?? []
  );
}

export async function getProductOverrides(): Promise<ProductOverride[]> {
  return (
    (await q<ProductOverride[]>(
      `*[_type == "productOverride"]{"storeKey": brand->storeKey, sku, hidden, dealerPrice, saleStarts, saleEnds, minQuantity, featured, dealerNote}`,
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

export async function getFooterPages(): Promise<{ title: string; slug: string }[]> {
  return (await q<{ title: string; slug: string }[]>(`*[_type == "page" && showInFooter == true] | order(title asc){title, "slug": slug.current}`)) ?? [];
}

// --- Appearance ---

export async function getThemeSettings(): Promise<ThemeSettings> {
  return (await settings())?.theme ?? {};
}

export type NavLink = { label: string; href: string; icon?: string };

export type HeaderSettings = {
  showLogo: boolean;
  sticky: boolean;
  /** Empty means the built-in Inventory + Orders links. */
  links: NavLink[];
  showPages: boolean;
  showContact: boolean;
};

export async function getHeaderSettings(): Promise<HeaderSettings> {
  const h = (await settings())?.header;
  return {
    showLogo: h?.showLogo ?? true,
    sticky: h?.sticky ?? true,
    links: (h?.links ?? []).filter((l) => l?.label && l?.href),
    showPages: h?.showPages ?? true,
    showContact: h?.showContact ?? false,
  };
}

export type FooterSettings = {
  tagline: string;
  showBrands: boolean;
  brandsHeading: string;
  columns: { title: string; links: { label: string; href: string }[] }[];
  showPolicies: boolean;
  showContact: boolean;
  social: { platform: string; url: string }[];
  copyright?: string;
};

export async function getFooterSettings(): Promise<FooterSettings> {
  const f = (await settings())?.footer;
  return {
    tagline: f?.tagline ?? "Wholesale ordering for authorized dealers, across all of our brands in one place.",
    showBrands: f?.showBrands ?? true,
    brandsHeading: f?.brandsHeading || "Our brands",
    columns: (f?.columns ?? []).filter((c) => c?.title).map((c) => ({ title: c.title, links: (c.links ?? []).filter((l) => l?.label && l?.href) })),
    showPolicies: f?.showPolicies ?? true,
    showContact: f?.showContact ?? true,
    social: (f?.social ?? []).filter((s) => s?.platform && s?.url?.startsWith("https://")),
    copyright: f?.copyright || undefined,
  };
}

// --- Security ---

export type SecuritySettings = {
  requireTwoFactorAdmins: boolean;
  requireTwoFactorDealers: boolean;
  sessionDays: number;
  maxLoginAttempts: number;
  lockoutMinutes: number;
  passwordMinLength: number;
  blockCommonPasswords: boolean;
};

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/**
 * Security policy from Studio. Every number is clamped to a safe range here, so a typo or
 * an unreachable Sanity can only ever fall back to the secure defaults.
 */
export async function getSecuritySettings(): Promise<SecuritySettings> {
  const s = (await settings())?.security;
  return {
    requireTwoFactorAdmins: s?.requireTwoFactorAdmins === true,
    requireTwoFactorDealers: s?.requireTwoFactorDealers === true,
    sessionDays: clamp(s?.sessionDays, 1, 30, 7),
    maxLoginAttempts: clamp(s?.maxLoginAttempts, 3, 10, 5),
    lockoutMinutes: clamp(s?.lockoutMinutes, 5, 1440, 15),
    passwordMinLength: clamp(s?.passwordMinLength, 10, 64, 10),
    blockCommonPasswords: s?.blockCommonPasswords !== false,
  };
}

// --- Plugins ---

export type PluginSettings = {
  analytics: { enabled: boolean; ga4Id?: string; gtmId?: string; metaPixelId?: string };
  cookieConsent: { enabled: boolean; message: string; acceptLabel: string; declineLabel: string; showPrivacyLink: boolean };
  maintenance: { enabled: boolean; title: string; message: string; until?: string };
};

const ID_PATTERNS = { ga4Id: /^G-[A-Z0-9]{4,15}$/, gtmId: /^GTM-[A-Z0-9]{4,12}$/, metaPixelId: /^\d{8,20}$/ } as const;

export async function getPluginSettings(): Promise<PluginSettings> {
  const p = (await settings())?.plugins;
  const a = p?.analytics ?? {};
  const c = p?.cookieConsent ?? {};
  const m = p?.maintenance ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  // IDs end up inside script URLs, so anything not matching the exact format is dropped.
  const id = (k: keyof typeof ID_PATTERNS) => {
    const v = str(a[k]);
    return v && ID_PATTERNS[k].test(v) ? v : undefined;
  };
  return {
    analytics: { enabled: a.enabled === true, ga4Id: id("ga4Id"), gtmId: id("gtmId"), metaPixelId: id("metaPixelId") },
    cookieConsent: {
      enabled: c.enabled === true,
      message: str(c.message) ?? "We use cookies to understand how the portal is used and to improve it.",
      acceptLabel: str(c.acceptLabel) ?? "Accept",
      declineLabel: str(c.declineLabel) ?? "Decline",
      showPrivacyLink: c.showPrivacyLink !== false,
    },
    maintenance: {
      enabled: m.enabled === true,
      title: str(m.title) ?? "We'll be right back",
      message: str(m.message) ?? "The dealer portal is down for scheduled maintenance. Please check back soon.",
      // Only a future time is worth showing ("Expected back …").
      until: ((u) => (u && Date.parse(u) > Date.now() ? u : undefined))(str(m.until)),
    },
  };
}

// --- Promotions & discount codes ---

export type Promotion = {
  id: string;
  title: string;
  summary?: string;
  imageUrl?: string;
  startsAt?: string;
  endsAt?: string;
  /** 0 for showcase-only promotions. */
  percentOff: number;
  brands: string[];
  categories: string[];
  skus: string[];
  code?: { code: string; description?: string; type: "percent" | "amount"; value: number };
};

/** Promotions that are on and haven't ended (including ones scheduled to start later). */
export async function getPromotions(): Promise<Promotion[]> {
  const rows = await q<(Omit<Promotion, "percentOff" | "brands" | "categories" | "skus"> & Partial<Pick<Promotion, "percentOff" | "brands" | "categories" | "skus">>)[]>(
    `*[_type == "promotion" && active != false && (!defined(endsAt) || endsAt > now())] | order(sortOrder asc, _createdAt desc){
      "id": _id, title, summary, "imageUrl": image.asset->url, startsAt, endsAt, percentOff, brands, categories, skus,
      "code": select(discountCode->active != false => discountCode->{ "code": upper(code), description, type, value })
    }`,
  );
  return (rows ?? []).map((r) => ({
    ...r,
    percentOff: typeof r.percentOff === "number" && r.percentOff > 0 && r.percentOff <= 90 ? r.percentOff : 0,
    brands: r.brands ?? [],
    categories: r.categories ?? [],
    skus: r.skus ?? [],
    code: r.code?.code ? r.code : undefined,
  }));
}

export type DiscountCodeDoc = {
  id: string;
  code: string;
  description?: string;
  type: "percent" | "amount";
  value: number;
  startsAt?: string;
  endsAt?: string;
  minSubtotal?: number;
  maxUses?: number;
  maxUsesPerDealer?: number;
  brands: string[];
  categories: string[];
  skus: string[];
};

/**
 * Look up a code (case-insensitive). Not cached: a code switched off or used up in Studio
 * must stop working at checkout immediately.
 */
export async function findDiscountCode(code: string): Promise<DiscountCodeDoc | null> {
  if (projectId === "replaceme") return null;
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,30}$/.test(clean)) return null;
  try {
    const d = await sanity.fetch<(Omit<DiscountCodeDoc, "brands" | "categories" | "skus"> & Partial<Pick<DiscountCodeDoc, "brands" | "categories" | "skus">>) | null>(
      `*[_type == "discountCode" && active != false && upper(code) == $code][0]{
        "id": _id, "code": upper(code), description, type, value, startsAt, endsAt, minSubtotal, maxUses, maxUsesPerDealer, brands, categories, skus
      }`,
      { code: clean },
      { cache: "no-store" },
    );
    if (!d || (d.type !== "percent" && d.type !== "amount") || !(d.value > 0)) return null;
    return { ...d, brands: d.brands ?? [], categories: d.categories ?? [], skus: d.skus ?? [] };
  } catch (err) {
    console.error("Sanity discount code lookup failed", err);
    return null;
  }
}
