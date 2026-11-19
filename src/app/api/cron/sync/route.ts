import { NextResponse, type NextRequest } from "next/server";
import { isCronRequest } from "@/lib/cron";
import { syncAllStores } from "@/lib/woo/sync-all";

export const maxDuration = 300;

/** Every 15 minutes: re-read products changed since the last sync (safety net for missed webhooks). */
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await syncAllStores(false));
}
