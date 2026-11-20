import "server-only";
import type { StoreConfig } from "./stores";

export class WooError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

/**
 * Turn WooCommerce's vague auth errors into an actionable hint. Shown on the
 * Store sync page, so an admin can fix the setting without reading logs.
 */
function diagnose(store: StoreConfig, res: Response, code?: string): string {
  const setting = `WOO_${store.envPrefix}`;
  // fetch drops the Authorization header when a redirect goes to another host,
  // so Woo sees an anonymous request and answers "cannot list resources".
  if (res.redirected) {
    const from = new URL(store.url).origin;
    const to = new URL(res.url).origin;
    if (from !== to) return ` (Cause: ${from} redirects to ${to}, which drops the API key. Set ${setting}_URL to ${to}.)`;
  }
  if (res.status !== 401 && res.status !== 403) return "";
  if (code === "woocommerce_rest_authentication_error") {
    return ` (Cause: the store rejected the API key. Check ${setting}_KEY (starts ck_) and ${setting}_SECRET (starts cs_) aren't swapped, revoked or padded with spaces.)`;
  }
  if (code === "woocommerce_rest_cannot_view" || code === "woocommerce_rest_cannot_create" || code === "woocommerce_rest_cannot_edit") {
    return (
      ` (Likely cause: the request reached the store without valid credentials. Check that the REST API key still exists and is Read/Write,` +
      ` that its WordPress user is still an Administrator or Shop Manager, and that the host or a security plugin isn't stripping` +
      ` the Authorization header (Apache fix in .htaccess: SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1).)`
    );
  }
  return "";
}

/** Minimal WooCommerce REST v3 client (HTTPS + basic auth). */
export async function woo<T>(
  store: StoreConfig,
  path: string,
  init: { method?: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
): Promise<{ data: T; totalPages: number }> {
  const url = new URL(`${store.url}/wp-json/wc/v3${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const auth = Buffer.from(`${store.consumerKey}:${store.consumerSecret}`).toString("base64");
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const { message, code } = (body ?? {}) as { message?: string; code?: string };
    throw new WooError(`${store.name}: ${message ?? res.statusText}${diagnose(store, res, code)}`, res.status, body);
  }
  return { data: body as T, totalPages: Number(res.headers.get("x-wp-totalpages") ?? "1") };
}

// --- Types for the fields we use ---

export type WooImage = { src: string };
export type WooCategory = { id: number; slug: string; name: string };

export type WooProduct = {
  id: number;
  name: string;
  type: "simple" | "variable" | "grouped" | "external" | string;
  status: string;
  sku: string;
  price: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: string;
  categories: WooCategory[];
  images: WooImage[];
  permalink: string;
  parent_id: number;
};

export type WooVariation = {
  id: number;
  sku: string;
  price: string;
  regular_price: string;
  manage_stock: boolean | "parent";
  stock_quantity: number | null;
  stock_status: string;
  image: WooImage | null;
  permalink: string;
  attributes: { name: string; option: string }[];
  status: string;
};

export type WooOrderLine = { product_id: number; variation_id: number; quantity: number };

export type WooOrder = {
  id: number;
  status: string;
  line_items: WooOrderLine[];
  meta_data: { key: string; value: unknown }[];
};
