import "server-only";
import { createClient } from "next-sanity";
import { apiVersion, dataset, projectId } from "./env";
import type { ThemeSettings } from "@/lib/theme";

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
      `*[_type == "brand"] | order(sortOrder asc){name, storeKey, "active": coalesce(active, true), "logoUrl": logo.asset->url, "footerLogoUrl": footerLogo.asset->url, color, website, description, notificationEmails, dealerDiscountPercent, sotRequiredCategories, shippingRestrictions[]{categorySlug, states, message}}`,
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

export async function getFooterPages(): Promise<{ title: string; slug: string }[]> {
  return (await q<{ title: string; slug: string }[]>(`*[_type == "page" && showInFooter == true] | order(title asc){title, "slug": slug.current}`)) ?? [];
}

// --- Appearance ---

export async function getThemeSettings(): Promise<ThemeSettings> {
  return (await q<ThemeSettings | null>(`*[_id == "themeSettings"][0]{preset, customAccent, customInk, customGold, headingFont, bodyFont, corners}`)) ?? {};
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
  const h = await q<Partial<HeaderSettings> | null>(`*[_id == "headerSettings"][0]{showLogo, sticky, links[]{label, href, icon}, showPages, showContact}`);
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
  const f = await q<Partial<FooterSettings> | null>(
    `*[_id == "footerSettings"][0]{tagline, showBrands, brandsHeading, columns[]{title, links[]{label, href}}, showPolicies, showContact, social[]{platform, url}, copyright}`,
  );
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
  const s = await q<Partial<SecuritySettings> | null>(`*[_id == "securitySettings"][0]`);
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
  const p = await q<{ analytics?: Record<string, unknown>; cookieConsent?: Record<string, unknown>; maintenance?: Record<string, unknown> } | null>(
    `*[_id == "pluginSettings"][0]{analytics, cookieConsent, maintenance}`,
  );
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
