"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Card, Flex, Select, Spinner, Stack, Text, TextInput } from "@sanity/ui";
import { useClient } from "sanity";
import { usePaneRouter } from "sanity/structure";
import { SearchIcon } from "@sanity/icons/Search";
import type { CatalogPage, CatalogRow } from "@/app/api/admin/catalog/route";

const API_VERSION = "2026-11-01";
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const BRANDS = [
  { key: "unknown-suppressors", name: "Unknown Suppressors" },
  { key: "unknown-munitions", name: "Unknown Munitions" },
  { key: "salmon-river-solutions", name: "Salmon River Solutions" },
  { key: "shoot2hunt", name: "Shoot2Hunt" },
];

// --- IDs for Product settings that don't exist yet ---------------------------------
// "po-<store>-<productId>-<variationId>": WooCommerce ids are unique and every product has
// them (most variations have no SKU). Opening one creates the settings document linked to
// the product, with brand, SKU and name filled in (productOverride-for-product template).

export const newOverrideId = (store: string, productId: number, variationId: number) => `po-${store}-${productId}-${variationId}`;

export function parseNewOverrideId(id: string): { store: string; productId: string; variationId: string } | null {
  for (const b of BRANDS) {
    const m = id.match(new RegExp(`^po-${b.key}-([0-9]+)-([0-9]+)$`));
    if (m) return { store: b.key, productId: m[1]!, variationId: m[2]! };
  }
  return null;
}

/** Same keys as src/lib/catalog.ts (overrideKey), so the portal and Studio agree. */
const keyById = (store: string, productId: number, variationId: number) => `id:${store}:${productId}:${variationId}`;
const keyBySku = (store: string, sku: string) => `sku:${store}:${sku.trim().toLowerCase()}`;

// --- Data -------------------------------------------------------------------------

type Override = { id: string; hidden?: boolean; featured?: boolean; dealerPrice?: number; saleStarts?: string; saleEnds?: string; draft: boolean };
type SettingsFilter = "all" | "with" | "sale" | "hidden" | "featured";

const saleIsCurrent = (o: Override) => {
  const now = Date.now();
  return (!o.saleStarts || Date.parse(o.saleStarts) <= now) && (!o.saleEnds || Date.parse(o.saleEnds) > now);
};

/** Product settings from Sanity, keyed "store:sku" (drafts included, live-updating). */
function useOverrides() {
  const client = useClient({ apiVersion: API_VERSION });
  const [map, setMap] = useState<Map<string, Override> | null>(null);
  const [brandCount, setBrandCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await client.fetch<{
      overrides: { _id: string; productId?: number; variationId?: number; sku?: string; store?: string; hidden?: boolean; featured?: boolean; dealerPrice?: number; saleStarts?: string; saleEnds?: string }[];
      brands: number;
    }>(
      `{
        "overrides": *[_type == "productOverride"]{_id, productId, variationId, sku, "store": brand->storeKey, hidden, featured, dealerPrice, saleStarts, saleEnds},
        "brands": count(*[_type == "brand" && !(_id in path("drafts.**"))])
      }`,
      {},
      { perspective: "raw" },
    );
    const m = new Map<string, Override>();
    for (const o of r.overrides) {
      if (!o.store || o._id.startsWith("versions.")) continue;
      const key = typeof o.productId === "number" ? keyById(o.store, o.productId, o.variationId ?? 0) : o.sku ? keyBySku(o.store, o.sku) : null;
      if (!key) continue;
      const draft = o._id.startsWith("drafts.");
      // Prefer the draft so unpublished edits show up here too.
      if (!m.has(key) || draft) {
        m.set(key, { id: o._id.replace(/^drafts\./, ""), hidden: o.hidden, featured: o.featured, dealerPrice: o.dealerPrice, saleStarts: o.saleStarts, saleEnds: o.saleEnds, draft });
      }
    }
    setMap(m);
    setBrandCount(r.brands);
  }, [client]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load once, then keep in sync with Sanity
    void load();
    const sub = client.listen(`*[_type in ["productOverride", "brand"]]`, {}, { visibility: "query", includeResult: false }).subscribe({
      next: () => {
        clearTimeout(timer);
        timer = setTimeout(() => void load(), 400);
      },
      error: () => {},
    });
    return () => {
      clearTimeout(timer);
      sub.unsubscribe();
    };
  }, [client, load]);

  return { overrides: map, brandCount, reload: load };
}

// --- Pane -------------------------------------------------------------------------

/**
 * Studio → Catalog → Products: every product synced from the WooCommerce stores, with its
 * dealer settings. Click one to open (or create) its Product settings.
 */
export function ProductsPane(props: { childItemId?: string }) {
  const client = useClient({ apiVersion: API_VERSION });
  const { overrides, brandCount } = useOverrides();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [brand, setBrand] = useState("");
  const [stock, setStock] = useState<"any" | "in" | "out" | "backorder">("any");
  const [settings, setSettings] = useState<SettingsFilter>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signin" | "error">("loading");
  const [creatingBrands, setCreatingBrands] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Settings filters are answered from Sanity: send the matching "store:sku" keys.
  const keys = useMemo(() => {
    if (settings === "all" || !overrides) return undefined;
    return [...overrides.entries()]
      .filter(([, o]) => (settings === "with" ? true : settings === "hidden" ? o.hidden : settings === "featured" ? o.featured : typeof o.dealerPrice === "number" && saleIsCurrent(o)))
      .map(([k]) => k);
  }, [settings, overrides]);
  const keysKey = keys ? keys.join("|") : "";

  useEffect(() => {
    if (settings !== "all" && !overrides) return;
    let cancelled = false;
    (async () => {
      setState((s) => (s === "ready" ? "ready" : "loading"));
      try {
        const res = await fetch("/api/admin/catalog", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: debouncedQ || undefined, brand: brand || undefined, stock, keys: keysKey ? keysKey.split("|") : keys, page }),
        });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) return setState("signin");
        if (!res.ok) return setState("error");
        setData((await res.json()) as CatalogPage);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // `keys` is represented by keysKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, brand, stock, keysKey, settings, page, overrides === null]);

  async function createBrands() {
    setCreatingBrands(true);
    try {
      const tx = client.transaction();
      BRANDS.forEach((b, i) => tx.createIfNotExists({ _id: `brand-${b.key}`, _type: "brand", name: b.name, storeKey: b.key, active: true, sortOrder: i, dealerDiscountPercent: 0 }));
      await tx.commit();
    } finally {
      setCreatingBrands(false);
    }
  }

  const setFilter = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <Stack gap={3} padding={3} className="products-pane">
      <style>{`.dp-row > a { display: block; color: inherit; text-decoration: none; border-radius: 4px; cursor: pointer; }
.dp-row > a:hover [data-ui="Card"] { background: var(--card-muted-bg-color, rgba(127,127,127,.08)); }
.products-pane select, .products-pane button:not(:disabled) { cursor: pointer; }`}</style>
      {brandCount === 0 && (
        <Card padding={3} radius={2} tone="caution" border>
          <Stack gap={3}>
            <Text size={1}>
              <strong>No brands yet.</strong> Product settings belong to a brand, and brands also hold the dealer discount, SOT
              categories and shipping rules. Create the four brands, then set them up under Catalog → Brands.
            </Text>
            <Flex>
              <Button text={creatingBrands ? "Creating…" : "Create the 4 brands"} tone="primary" fontSize={1} disabled={creatingBrands} onClick={createBrands} />
            </Flex>
          </Stack>
        </Card>
      )}

      <TextInput icon={SearchIcon} fontSize={1} placeholder="Search name or SKU…" value={q} onChange={(e) => setFilter(setQ)(e.currentTarget.value)} />
      <Flex gap={2} wrap="wrap">
        <Box flex={1} style={{ minWidth: 140 }}>
          <Select fontSize={1} value={brand} onChange={(e) => setFilter(setBrand)(e.currentTarget.value)}>
            <option value="">All brands</option>
            {(data?.stores ?? BRANDS).map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
          </Select>
        </Box>
        <Box flex={1} style={{ minWidth: 120 }}>
          <Select fontSize={1} value={stock} onChange={(e) => setFilter(setStock)(e.currentTarget.value as typeof stock)}>
            <option value="any">Any stock</option>
            <option value="in">In stock</option>
            <option value="backorder">Backorder</option>
            <option value="out">Out of stock</option>
          </Select>
        </Box>
        <Box flex={1} style={{ minWidth: 140 }}>
          <Select fontSize={1} value={settings} onChange={(e) => setFilter(setSettings)(e.currentTarget.value as SettingsFilter)}>
            <option value="all">All products</option>
            <option value="with">Has product settings</option>
            <option value="sale">Dealer price / on sale</option>
            <option value="hidden">Hidden from dealers</option>
            <option value="featured">Featured</option>
          </Select>
        </Box>
      </Flex>

      {state === "signin" && (
        <Card padding={3} radius={2} tone="caution" border>
          <Text size={1}>
            The product list comes from the portal, so sign in to the portal as an admin in this browser.{" "}
            <a href="/login?next=/studio" target="_blank" rel="noreferrer">Sign in</a>, then reopen this list.
          </Text>
        </Card>
      )}
      {state === "error" && (
        <Card padding={3} radius={2} tone="critical" border>
          <Text size={1}>Couldn&apos;t load products. Try again in a moment.</Text>
        </Card>
      )}
      {state === "loading" && !data && <Flex justify="center" padding={4}><Spinner muted /></Flex>}

      {data && state !== "signin" && (
        <>
          <Text size={0} muted>
            {data.total.toLocaleString()} product{data.total === 1 ? "" : "s"}
            {data.pages > 1 ? ` · page ${data.page} of ${data.pages}` : ""}
          </Text>
          {data.rows.length === 0 ? (
            <Box padding={3}><Text size={1} muted>No products match.</Text></Box>
          ) : (
            <Stack gap={1} style={{ opacity: state === "loading" ? 0.6 : 1 }}>
              {data.rows.map((r) => (
                <ProductRow
                  key={r.id}
                  row={r}
                  override={overrides?.get(keyById(r.store, r.productId, r.variationId)) ?? (r.sku ? overrides?.get(keyBySku(r.store, r.sku)) : undefined)}
                  selectedId={props.childItemId}
                />
              ))}
            </Stack>
          )}
          {data.pages > 1 && (
            <Flex gap={2} justify="space-between" align="center">
              <Button fontSize={1} mode="ghost" text="‹ Previous" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} />
              <Text size={1} muted>{data.page} / {data.pages}</Text>
              <Button fontSize={1} mode="ghost" text="Next ›" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} />
            </Flex>
          )}
        </>
      )}
    </Stack>
  );
}

function ProductRow({ row, override, selectedId }: { row: CatalogRow; override?: Override; selectedId?: string }) {
  const { ChildLink } = usePaneRouter();
  // Every product can be opened: existing settings by their id, new ones by the product's ids.
  const childId = override?.id ?? newOverrideId(row.store, row.productId, row.variationId);
  const selected = Boolean(childId && selectedId === childId);
  const price = typeof override?.dealerPrice === "number" && saleIsCurrent(override) ? override.dealerPrice : null;
  const onSale = price !== null && row.regularPrice !== null && price < row.regularPrice;

  const content = (
    <Card padding={2} radius={2} tone={selected ? "primary" : "default"} pressed={selected} selected={selected} style={{ opacity: override?.hidden ? 0.6 : 1 }}>
      <Flex gap={3} align="center">
        {row.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.imageUrl} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
        ) : (
          <Box style={{ width: 40, height: 40, borderRadius: 4, background: "var(--card-border-color)", flexShrink: 0 }} />
        )}
        <Stack gap={2} flex={1} style={{ minWidth: 0 }}>
          <Text size={1} weight="semibold" textOverflow="ellipsis">{row.name}</Text>
          <Text size={0} muted textOverflow="ellipsis">
            {row.brandName} · {row.sku ?? "no SKU"}
          </Text>
          <Flex gap={1} wrap="wrap">
            {row.stock === "out" ? (
              <Badge tone="critical" fontSize={0}>Out of stock</Badge>
            ) : row.stock === "backorder" ? (
              <Badge tone="caution" fontSize={0}>Backorder</Badge>
            ) : (
              <Badge tone="positive" fontSize={0}>{row.stockQuantity !== null ? `${row.stockQuantity} in stock` : "In stock"}</Badge>
            )}
            {override?.hidden && <Badge tone="critical" fontSize={0}>Hidden</Badge>}
            {override?.featured && <Badge tone="primary" fontSize={0}>Featured</Badge>}
            {onSale && <Badge tone="critical" fontSize={0}>Sale</Badge>}
            {override?.draft && <Badge tone="caution" fontSize={0}>Unpublished changes</Badge>}
          </Flex>
        </Stack>
        <Stack gap={2} style={{ textAlign: "right", flexShrink: 0 }}>
          <Text size={1} weight="semibold">
            {price !== null ? usd(price) : row.regularPrice !== null ? usd(row.regularPrice) : "—"}
          </Text>
          {onSale && row.regularPrice !== null ? (
            <Text size={0} muted style={{ textDecoration: "line-through" }}>{usd(row.regularPrice)}</Text>
          ) : (
            <Text size={0} muted>{row.retailPrice !== null ? `retail ${usd(row.retailPrice)}` : "no retail"}</Text>
          )}
        </Stack>
      </Flex>
    </Card>
  );

  return (
    <div className="dp-row">
      <ChildLink childId={childId}>{content}</ChildLink>
    </div>
  );
}
