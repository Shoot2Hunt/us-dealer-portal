import "server-only";
import { eq, inArray } from "drizzle-orm";
import { accessRequests, db, licenseDocuments, type LicenseDocKind, type User } from "@/lib/db";
import { isAdmin } from "@/lib/auth/session";

/**
 * Per-file cap. Two files plus the form must stay under Vercel's 4.5MB request
 * limit, and under serverActions.bodySizeLimit in next.config.ts.
 */
export const MAX_LICENSE_FILE_BYTES = 2 * 1024 * 1024;

export const LICENSE_DOC_LABEL: Record<LicenseDocKind, string> = { ffl: "FFL", sot: "SOT" };

export type LicenseDocMeta = {
  id: string;
  kind: LicenseDocKind;
  fileName: string;
  contentType: string;
  size: number;
  accessRequestId: string | null;
  userId: string | null;
};

const metaColumns = {
  id: licenseDocuments.id,
  kind: licenseDocuments.kind,
  fileName: licenseDocuments.fileName,
  contentType: licenseDocuments.contentType,
  size: licenseDocuments.size,
  accessRequestId: licenseDocuments.accessRequestId,
  userId: licenseDocuments.userId,
};

/** Work out the real file type from its first bytes. The browser's type is not trusted. */
function sniffType(b: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...b.subarray(start, end));
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export type ValidatedLicenseFile = { kind: LicenseDocKind; fileName: string; contentType: string; size: number; data: string };

/**
 * Validate an optional uploaded file from a form. Returns null when nothing was
 * chosen, a string error message when it's not acceptable, or the file ready to save.
 */
export async function readLicenseFile(value: FormDataEntryValue | null, kind: LicenseDocKind): Promise<ValidatedLicenseFile | string | null> {
  if (!(value instanceof File) || value.size === 0) return null;
  const label = LICENSE_DOC_LABEL[kind];
  if (value.size > MAX_LICENSE_FILE_BYTES) return `Your ${label} file is too large (2MB max).`;
  const bytes = new Uint8Array(await value.arrayBuffer());
  const contentType = sniffType(bytes);
  if (!contentType) return `Your ${label} file must be a PDF, JPG, PNG or WebP.`;
  const fileName = (value.name || `${kind}`).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return { kind, fileName, contentType, size: value.size, data: Buffer.from(bytes).toString("base64") };
}

export async function saveLicenseFiles(accessRequestId: string, files: ValidatedLicenseFile[]) {
  if (!files.length) return;
  await db().insert(licenseDocuments).values(files.map((f) => ({ ...f, accessRequestId })));
}

/** Metadata only (no file bytes) for the given access requests. */
export async function docsForRequests(requestIds: string[]): Promise<LicenseDocMeta[]> {
  if (!requestIds.length) return [];
  return db().select(metaColumns).from(licenseDocuments).where(inArray(licenseDocuments.accessRequestId, requestIds));
}

/** Metadata only (no file bytes) for the given dealers. */
export async function docsForUsers(userIds: string[]): Promise<LicenseDocMeta[]> {
  if (!userIds.length) return [];
  return db().select(metaColumns).from(licenseDocuments).where(inArray(licenseDocuments.userId, userIds));
}

/**
 * Who may see a license document: the dealer it belongs to, super admins, and
 * brand admins (limited to their own brand while it's still an access request,
 * matching what the requests page shows them).
 */
export async function canViewLicenseDoc(viewer: User, doc: LicenseDocMeta): Promise<boolean> {
  if (doc.userId && doc.userId === viewer.id) return true;
  if (!isAdmin(viewer)) return false;
  if (viewer.role === "super_admin" || doc.userId) return true;
  if (!doc.accessRequestId) return false;
  const [req] = await db().select({ brandSlug: accessRequests.brandSlug }).from(accessRequests).where(eq(accessRequests.id, doc.accessRequestId));
  return !!req && req.brandSlug === viewer.brandSlug;
}

export function licenseDocUrl(id: string, download = false) {
  return `/api/license-documents/${id}${download ? "?download=1" : ""}`;
}
