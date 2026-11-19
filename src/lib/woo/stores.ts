import "server-only";

/**
 * The four WooCommerce stores. The `key` must match the brand's slug in Sanity.
 * Secrets come from env vars: WOO_<PREFIX>_URL, _KEY, _SECRET, _WEBHOOK_SECRET.
 */
export const STORES = [
  { key: "unknown-suppressors", name: "Unknown Suppressors", envPrefix: "UNKNOWN_SUPPRESSORS" },
  { key: "unknown-munitions", name: "Unknown Munitions", envPrefix: "UNKNOWN_MUNITIONS" },
  { key: "salmon-river-solutions", name: "Salmon River Solutions", envPrefix: "SALMON_RIVER" },
  { key: "shoot2hunt", name: "Shoot2Hunt", envPrefix: "SHOOT2HUNT" },
] as const;

export type StoreKey = (typeof STORES)[number]["key"];

export type StoreConfig = {
  key: StoreKey;
  name: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  webhookSecret: string;
};

export function isStoreKey(value: string | null | undefined): value is StoreKey {
  return STORES.some((s) => s.key === value);
}

export function getStore(key: StoreKey): StoreConfig {
  const def = STORES.find((s) => s.key === key);
  if (!def) throw new Error(`Unknown store ${key}`);
  const env = (name: string) => process.env[`WOO_${def.envPrefix}_${name}`] ?? "";
  return {
    key: def.key,
    name: def.name,
    url: env("URL").replace(/\/$/, ""),
    consumerKey: env("KEY"),
    consumerSecret: env("SECRET"),
    webhookSecret: env("WEBHOOK_SECRET"),
  };
}

export function configuredStores(): StoreConfig[] {
  return STORES.map((s) => getStore(s.key)).filter((s) => s.url && s.consumerKey && s.consumerSecret);
}

export function storeName(key: string): string {
  return STORES.find((s) => s.key === key)?.name ?? key;
}
