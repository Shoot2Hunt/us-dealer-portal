import { NextResponse, type NextRequest } from "next/server";
import { isCronRequest } from "@/lib/cron";
import { syncAllStores } from "@/lib/woo/sync-all";

export const maxDuration = 300;

/** Nightly: re-read every product and drop anything unpublished or deleted. */
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await syncAllStores(true));
}
