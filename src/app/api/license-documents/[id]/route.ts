import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, licenseDocuments } from "@/lib/db";
import { getApiUser } from "@/lib/auth/session";
import { canViewLicenseDoc } from "@/lib/license-docs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Streams an FFL/SOT file to admins and to the dealer who uploaded it. Everyone else gets 404. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const [doc] = await db().select().from(licenseDocuments).where(eq(licenseDocuments.id, id));
  if (!doc || !(await canViewLicenseDoc(user, doc))) return new Response("Not found", { status: 404 });

  const disposition = req.nextUrl.searchParams.has("download") ? "attachment" : "inline";
  return new Response(Buffer.from(doc.data, "base64"), {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Disposition": `${disposition}; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
