import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { parseBody } from "next-sanity/webhook";

/**
 * Optional Sanity webhook (Sanity → API → Webhooks) so Studio edits show up instantly
 * instead of within 30 seconds. Set its secret to SANITY_REVALIDATE_SECRET.
 */
export async function POST(req: NextRequest) {
  const { isValidSignature } = await parseBody(req, process.env.SANITY_REVALIDATE_SECRET);
  if (!isValidSignature) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  revalidateTag("sanity", { expire: 0 });
  return NextResponse.json({ revalidated: true });
}
