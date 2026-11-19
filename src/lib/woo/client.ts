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
    const msg = (body as { message?: string } | null)?.message ?? res.statusText;
    throw new WooError(`${store.name}: ${msg}`, res.status, body);
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
