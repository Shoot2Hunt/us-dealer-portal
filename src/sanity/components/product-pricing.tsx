"use client";

import { useEffect, useState } from "react";
import { Box, Card, Flex, Spinner, Stack, Text, TextInput } from "@sanity/ui";
import { set, useClient, useDocumentOperation, useFormValue, type NumberInputProps, type StringInputProps } from "sanity";
import type { AdminProduct } from "@/app/api/admin/products/route";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const API_VERSION = "2026-11-01";

async function fetchProducts(params: Record<string, string>): Promise<AdminProduct[] | "signin"> {
  const res = await fetch(`/api/admin/products?${new URLSearchParams(params)}`, { credentials: "same-origin", cache: "no-store" });
  if (res.status === 401 || res.status === 403) return "signin";
  if (!res.ok) return [];
  return ((await res.json()) as { products: AdminProduct[] }).products;
}

/** Whether the optional sale dates haven't started yet, or have already passed. */
function saleWindow(starts?: string, ends?: string) {
  const now = Date.now();
  return { scheduled: Boolean(starts && Date.parse(starts) > now), ended: Boolean(ends && Date.parse(ends) <= now) };
}

const SignInHint = () => (
  <Card padding={3} radius={2} tone="caution" border>
    <Text size={1}>
      Sign in to the portal as an admin in this browser to search products and preview prices.{" "}
      <a href="/login?next=/studio" target="_blank" rel="noreferrer">Sign in</a>
    </Text>
  </Card>
);

/**
 * SKU field with a product finder: search the synced catalog by name or SKU, click a
 * result to fill in the SKU, label and brand.
 */
export function SkuInput(props: StringInputProps) {
  const { onChange, renderDefault } = props;
  const id = (useFormValue(["_id"]) as string | undefined)?.replace(/^drafts\./, "") ?? "";
  const label = useFormValue(["label"]) as string | undefined;
  const { patch } = useDocumentOperation(id, "productOverride");
  const client = useClient({ apiVersion: API_VERSION });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminProduct[] | "signin" | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await fetchProducts({ q: query.trim() });
      if (!cancelled) {
        setResults(r);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  async function pick(p: AdminProduct) {
    // Link by WooCommerce ids (unique, always present). The SKU is filled in when there is one.
    if (p.sku) onChange(set(p.sku));
    const brandId = await client.fetch<string | null>(`*[_type == "brand" && storeKey == $k][0]._id`, { k: p.store });
    patch.execute([
      {
        set: {
          productId: p.productId,
          variationId: p.variationId,
          ...(label ? {} : { label: p.name }),
          ...(brandId ? { brand: { _type: "reference", _ref: brandId.replace(/^drafts\./, "") } } : {}),
        },
      },
    ]);
    setQuery("");
    setResults(null);
  }

  const shown = query.trim().length >= 2 ? results : null;
  return (
    <Stack gap={3}>
      {renderDefault(props)}
      <TextInput
        fontSize={1}
        placeholder="Find a product by name or SKU…"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        suffix={loading ? <Box padding={2}><Spinner muted /></Box> : undefined}
      />
      {shown === "signin" && <SignInHint />}
      {Array.isArray(shown) && (
        <Card radius={2} border>
          {shown.length === 0 ? (
            <Box padding={3}><Text size={1} muted>No products match.</Text></Box>
          ) : (
            <Stack>
              {shown.map((p) => (
                <Card key={`${p.store}:${p.productId}:${p.variationId}`} as="button" padding={2} onClick={() => pick(p)} style={{ textAlign: "left", cursor: "pointer", width: "100%" }}>
                  <Flex gap={3} align="center">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" width={36} height={36} style={{ objectFit: "cover", borderRadius: 4 }} />
                    ) : (
                      <Box style={{ width: 36, height: 36 }} />
                    )}
                    <Box flex={1}>
                      <Text size={1} weight="semibold" textOverflow="ellipsis">{p.name}</Text>
                      <Box marginTop={1}>
                        <Text size={0} muted>
                          {p.brandName} · {p.sku ?? "no SKU"} · {p.retailPrice !== null ? `retail ${usd(p.retailPrice)}` : "no retail price"}
                        </Text>
                      </Box>
                    </Box>
                  </Flex>
                </Card>
              ))}
            </Stack>
          )}
        </Card>
      )}
    </Stack>
  );
}

/**
 * Dealer price field with a live preview: retail, the regular dealer price, and what
 * dealers will see (sale with the old price crossed out, or just the new price).
 */
export function DealerPriceInput(props: NumberInputProps) {
  const { value, renderDefault } = props;
  const sku = useFormValue(["sku"]) as string | undefined;
  const productId = useFormValue(["productId"]) as number | undefined;
  const variationId = useFormValue(["variationId"]) as number | undefined;
  const brandRef = (useFormValue(["brand"]) as { _ref?: string } | undefined)?._ref;
  const saleStarts = useFormValue(["saleStarts"]) as string | undefined;
  const saleEnds = useFormValue(["saleEnds"]) as string | undefined;
  const client = useClient({ apiVersion: API_VERSION });
  const [product, setProduct] = useState<AdminProduct | null | "signin" | "loading">(null);
  const linked = typeof productId === "number" || Boolean(sku);

  useEffect(() => {
    if (!linked || !brandRef) return;
    let cancelled = false;
    (async () => {
      setProduct("loading");
      const store = await client.fetch<string | null>(`*[_id in [$id, "drafts." + $id]][0].storeKey`, { id: brandRef });
      // Linked products are found by their WooCommerce ids; older settings by SKU.
      const query: Record<string, string> | null = store
        ? typeof productId === "number"
          ? { store, productId: String(productId), variationId: String(variationId ?? 0) }
          : { store, sku: sku! }
        : null;
      const r = query ? await fetchProducts(query) : [];
      if (!cancelled) setProduct(r === "signin" ? "signin" : r[0] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [linked, sku, productId, variationId, brandRef, client]);

  let preview: React.ReactNode = null;
  if (!linked || !brandRef) preview = <Text size={1} muted>Pick the brand and product above to preview prices.</Text>;
  else if (product === "loading") preview = <Spinner muted />;
  else if (product === "signin") preview = <SignInHint />;
  else if (product === null) preview = <Text size={1} muted>This product isn&apos;t in the synced catalog (it may have been removed from the store).</Text>;
  else {
    const regular = product.regularPrice;
    const { scheduled, ended } = saleWindow(saleStarts, saleEnds);
    const lines: React.ReactNode[] = [
      <Text key="r" size={1}>Retail: <strong>{product.retailPrice !== null ? usd(product.retailPrice) : "—"}</strong></Text>,
      <Text key="g" size={1}>
        Regular dealer price: <strong>{regular !== null ? usd(regular) : "—"}</strong>
        {product.brandDiscountPercent ? ` (${product.brandDiscountPercent}% brand discount)` : " (no brand discount set)"}
      </Text>,
    ];
    let tone: "positive" | "caution" | "default" = "default";
    let verdict = "No dealer price set here: dealers pay the regular dealer price.";
    if (typeof value === "number") {
      if (regular !== null && value < regular) {
        tone = "positive";
        verdict = `Dealers see ${usd(value)} with ${usd(regular)} crossed out and a Sale badge (save ${Math.round((1 - value / regular) * 100)}%).`;
      } else if (regular !== null && value > regular) {
        tone = "caution";
        verdict = `Higher than the regular dealer price: dealers simply pay ${usd(value)}.`;
      } else verdict = `Dealers pay ${usd(value)}.`;
      if (scheduled) verdict += ` Starts ${new Date(saleStarts!).toLocaleString()}; until then they pay the regular price.`;
      if (ended) {
        tone = "caution";
        verdict = `The sale dates have passed, so dealers pay the regular price again.`;
      }
    }
    preview = (
      <Stack gap={2}>
        {lines}
        <Card padding={2} radius={2} tone={tone} border>
          <Text size={1}>{verdict}</Text>
        </Card>
        <Text size={0} muted>A dealer&apos;s volume tier or a running promotion can still lower the price further.</Text>
      </Stack>
    );
  }

  return (
    <Stack gap={3}>
      {renderDefault(props)}
      <Card padding={3} radius={2} tone="transparent" border>
        {preview}
      </Card>
    </Stack>
  );
}
