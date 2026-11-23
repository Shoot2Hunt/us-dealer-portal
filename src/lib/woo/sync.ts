import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db, inventory, syncState } from "@/lib/db";
import { woo, WooError, type WooProduct, type WooVariation } from "./client";
import { getStore, type StoreConfig, type StoreKey } from "./stores";

type Row = typeof inventory.$inferInsert;

/** Product-level fields for the detail page, shared by a product's variations. */
function details(p: WooProduct) {
  return {
    description: p.description?.trim() || null,
    shortDescription: p.short_description?.trim() || null,
    images: (p.images ?? []).map((i) => i.src).filter(Boolean),
    specs: (p.attributes ?? [])
      .filter((a) => a.visible && !a.variation && a.options?.length)
      .map((a) => ({ name: a.name, value: a.options.join(", ") })),
  };
}

function productRow(store: StoreKey, p: WooProduct): Row {
  return {
    store,
    productId: p.id,
    variationId: 0,
    parentName: null,
    name: p.name,
    sku: p.sku || null,
    categories: p.categories.map((c) => c.slug),
    manageStock: p.manage_stock,
    stockQuantity: p.stock_quantity,
    stockStatus: p.stock_status,
    retailPrice: p.price || p.regular_price || null,
    imageUrl: p.images[0]?.src ?? null,
    permalink: p.permalink,
    ...details(p),
    attributes: [],
    updatedAt: new Date(),
  };
}

function variationRow(store: StoreKey, parent: WooProduct, v: WooVariation): Row {
  const label = v.attributes.map((a) => a.option).join(" / ");
  return {
    store,
    productId: parent.id,
    variationId: v.id,
    parentName: parent.name,
    name: label ? `${parent.name} — ${label}` : parent.name,
    sku: v.sku || parent.sku || null,
    categories: parent.categories.map((c) => c.slug),
    // "parent" means stock is tracked on the parent product.
    manageStock: v.manage_stock === true || v.manage_stock === "parent",
    stockQuantity: v.manage_stock === "parent" ? parent.stock_quantity : v.stock_quantity,
    stockStatus: v.stock_status,
    retailPrice: v.price || v.regular_price || null,
    imageUrl: v.image?.src ?? parent.images[0]?.src ?? null,
    permalink: v.permalink || parent.permalink,
    ...details(parent),
    // A variation's own description (often a one-liner) replaces the parent's short one.
    shortDescription: v.description?.trim() || parent.short_description?.trim() || null,
    attributes: v.attributes.filter((a) => a.option).map((a) => ({ name: a.name, option: a.option })),
    updatedAt: new Date(),
  };
}

async function fetchVariations(store: StoreConfig, productId: number): Promise<WooVariation[]> {
  const all: WooVariation[] = [];
  for (let page = 1; ; page++) {
    const { data, totalPages } = await woo<WooVariation[]>(store, `/products/${productId}/variations`, {
      query: { per_page: 100, page },
    });
    all.push(...data);
    if (page >= totalPages) break;
  }
  return all;
}

async function rowsForProduct(store: StoreConfig, p: WooProduct): Promise<Row[]> {
  if (p.status !== "publish") return [];
  if (p.type === "variable") {
    const variations = await fetchVariations(store, p.id);
    return variations.filter((v) => v.status === "publish").map((v) => variationRow(store.key, p, v));
  }
  if (p.type === "grouped" || p.type === "external") return [];
  return [productRow(store.key, p)];
}

async function upsert(rows: Row[]) {
  if (!rows.length) return;
  // Neon's HTTP driver has a payload limit; chunk large upserts.
  for (let i = 0; i < rows.length; i += 200) {
    await db()
      .insert(inventory)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: [inventory.store, inventory.productId, inventory.variationId],
        set: {
          parentName: sql`excluded.parent_name`,
          name: sql`excluded.name`,
          sku: sql`excluded.sku`,
          categories: sql`excluded.categories`,
          manageStock: sql`excluded.manage_stock`,
          stockQuantity: sql`excluded.stock_quantity`,
          stockStatus: sql`excluded.stock_status`,
          retailPrice: sql`excluded.retail_price`,
          imageUrl: sql`excluded.image_url`,
          permalink: sql`excluded.permalink`,
          description: sql`excluded.description`,
          shortDescription: sql`excluded.short_description`,
          images: sql`excluded.images`,
          attributes: sql`excluded.attributes`,
          specs: sql`excluded.specs`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

/**
 * Re-fetch one product (and its variations) from the store and replace its rows.
 * Called from webhooks and before checkout. `id` may be a product or a variation id.
 */
export async function refreshProduct(storeKey: StoreKey, id: number): Promise<void> {
  const store = getStore(storeKey);
  let product: WooProduct;
  try {
    product = (await woo<WooProduct>(store, `/products/${id}`)).data;
    // A variation id returns the variation as a product with parent_id set.
    if (product.parent_id) product = (await woo<WooProduct>(store, `/products/${product.parent_id}`)).data;
  } catch (err) {
    if (err instanceof WooError && err.status === 404) {
      await removeProduct(storeKey, id);
      return;
    }
    throw err;
  }
  const rows = await rowsForProduct(store, product);
  await upsert(rows);
  // Drop variations that no longer exist (or the whole product if unpublished).
  const keep = rows.map((r) => r.variationId ?? 0);
  await db()
    .delete(inventory)
    .where(
      and(
        eq(inventory.store, storeKey),
        eq(inventory.productId, product.id),
        keep.length ? notInArray(inventory.variationId, keep) : undefined,
      ),
    );
}

export async function removeProduct(storeKey: StoreKey, productId: number) {
  await db().delete(inventory).where(and(eq(inventory.store, storeKey), eq(inventory.productId, productId)));
}

/**
 * Sync a store. `full` re-reads every product and removes anything no longer published;
 * otherwise only products modified since the last sync are read.
 */
export async function syncStore(storeKey: StoreKey, { full = false } = {}): Promise<{ products: number; rows: number }> {
  const store = getStore(storeKey);
  const startedAt = new Date();
  const [state] = await db().select().from(syncState).where(eq(syncState.store, storeKey));
  const since = !full && state?.lastSyncedAt ? new Date(state.lastSyncedAt.getTime() - 5 * 60_000) : null;

  let products = 0;
  const seen = new Set<number>();
  let rowsWritten = 0;
  try {
    for (let page = 1; ; page++) {
      const { data, totalPages } = await woo<WooProduct[]>(store, "/products", {
        query: {
          per_page: 100,
          page,
          status: full ? "publish" : "any",
          modified_after: since?.toISOString(),
          dates_are_gmt: since ? true : undefined,
        },
      });
      for (const p of data) {
        products++;
        seen.add(p.id);
        if (p.status !== "publish") {
          await removeProduct(storeKey, p.id);
          continue;
        }
        const rows = await rowsForProduct(store, p);
        await upsert(rows);
        rowsWritten += rows.length;
      }
      if (page >= totalPages || data.length === 0) break;
    }
    if (full && seen.size) {
      await db()
        .delete(inventory)
        .where(and(eq(inventory.store, storeKey), notInArray(inventory.productId, [...seen])));
    }
    await db()
      .insert(syncState)
      .values({ store: storeKey, lastSyncedAt: startedAt, lastError: null })
      .onConflictDoUpdate({ target: syncState.store, set: { lastSyncedAt: startedAt, lastError: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db()
      .insert(syncState)
      .values({ store: storeKey, lastError: message })
      .onConflictDoUpdate({ target: syncState.store, set: { lastError: message } });
    throw err;
  }
  return { products, rows: rowsWritten };
}

export async function markWebhook(storeKey: StoreKey) {
  const now = new Date();
  await db()
    .insert(syncState)
    .values({ store: storeKey, lastWebhookAt: now })
    .onConflictDoUpdate({ target: syncState.store, set: { lastWebhookAt: now } });
}
