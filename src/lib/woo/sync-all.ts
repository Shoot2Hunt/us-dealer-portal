import "server-only";
import { configuredStores } from "./stores";
import { syncStore } from "./sync";

export async function syncAllStores(full: boolean) {
  const results: Record<string, unknown> = {};
  for (const store of configuredStores()) {
    try {
      results[store.key] = await syncStore(store.key, { full });
    } catch (err) {
      results[store.key] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { full, results };
}
