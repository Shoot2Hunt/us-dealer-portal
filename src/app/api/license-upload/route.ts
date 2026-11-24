import { NextResponse, type NextRequest } from "next/server";
import { readLicenseFile, saveUnclaimedLicenseFile } from "@/lib/license-docs";
import { clientKey, rateLimit, tooManyMessage } from "@/lib/rate-limit";

/**
 * One FFL or SOT copy from the request-access form, uploaded as soon as it's picked.
 * Files go up one per request so each can be up to 4MB (Vercel caps a request at 4.5MB).
 * The file is checked by its real type, stored unattached, and claimed by the request.
 */
export async function POST(req: NextRequest) {
  const limit = await rateLimit(`license-upload:${await clientKey()}`, 20, 60);
  if (!limit.ok) return NextResponse.json({ ok: false, error: tooManyMessage(limit.retryMinutes) }, { status: 429 });

  const form = await req.formData().catch(() => null);
  const kind = form?.get("kind");
  if (!form || (kind !== "ffl" && kind !== "sot")) return NextResponse.json({ ok: false, error: "Choose a file to upload." }, { status: 400 });

  const file = await readLicenseFile(form.get("file"), kind);
  if (!file) return NextResponse.json({ ok: false, error: "Choose a file to upload." }, { status: 400 });
  if (typeof file === "string") return NextResponse.json({ ok: false, error: file }, { status: 422 });
  try {
    const id = await saveUnclaimedLicenseFile(file);
    return NextResponse.json({ ok: true, id, fileName: file.fileName, size: file.size });
  } catch (err) {
    console.error("[license-upload]", err);
    return NextResponse.json({ ok: false, error: "Couldn't save the file. Please try again." }, { status: 500 });
  }
}
