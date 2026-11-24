import "server-only";
import { and, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { accessRequests, db, licenseDocuments, type LicenseDocKind, type User } from "@/lib/db";
import { isAdmin } from "@/lib/auth/session";

/**
 * Per-file cap. Each file is uploaded in its own request (/api/license-upload), which must
 * stay under Vercel's 4.5MB request limit, so 4MB is the most a single file can be.
 */
export const MAX_LICENSE_FILE_BYTES = 4 * 1024 * 1024;
/** An uploaded copy not yet attached to a request is kept this long, then deleted. */
const UNCLAIMED_UPLOAD_HOURS = 24;

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
  if (value.size > MAX_LICENSE_FILE_BYTES) return `Your ${label} file is too large (4MB max).`;
  const bytes = new Uint8Array(await value.arrayBuffer());
  const contentType = sniffType(bytes);
  if (!contentType) return `Your ${label} file must be a PDF, JPG, PNG or WebP.`;
  const fileName = (value.name || `${kind}`).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return { kind, fileName, contentType, size: value.size, data: Buffer.from(bytes).toString("base64") };
}

/**
 * Save a copy uploaded from the request-access form before the request exists. It belongs
 * to no one until claimLicenseUploads attaches it; unclaimed copies are deleted after a day.
 */
export async function saveUnclaimedLicenseFile(file: ValidatedLicenseFile, uploadTokenHash: string): Promise<string> {
  const cutoff = new Date(Date.now() - UNCLAIMED_UPLOAD_HOURS * 3600_000);
  await db()
    .delete(licenseDocuments)
    .where(and(isNull(licenseDocuments.accessRequestId), isNull(licenseDocuments.userId), lt(licenseDocuments.createdAt, cutoff)));
  const [row] = await db().insert(licenseDocuments).values({ ...file, uploadTokenHash }).returning({ id: licenseDocuments.id });
  return row.id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check the uploaded copies named in a request: each must exist, be the right kind, be
 * recent and not already belong to a request or dealer. Returns their names, or an error.
 */
export async function findUnclaimedUploads(ids: Record<LicenseDocKind, string>, uploadTokenHash: string | null): Promise<{ kind: LicenseDocKind; fileName: string; id: string }[] | string> {
  const wanted = Object.entries(ids) as [LicenseDocKind, string][];
  for (const [kind, id] of wanted) if (!UUID.test(id)) return `Upload a copy of your ${LICENSE_DOC_LABEL[kind]} (PDF, JPG, PNG or WebP, up to 4MB).`;
  if (!uploadTokenHash) return "Your uploads have expired (your browser session ended). Please upload the copies again.";
  const cutoff = new Date(Date.now() - UNCLAIMED_UPLOAD_HOURS * 3600_000);
  const rows = await db()
    .select({ id: licenseDocuments.id, kind: licenseDocuments.kind, fileName: licenseDocuments.fileName })
    .from(licenseDocuments)
    .where(and(inArray(licenseDocuments.id, wanted.map(([, id]) => id)), isNull(licenseDocuments.accessRequestId), isNull(licenseDocuments.userId), gt(licenseDocuments.createdAt, cutoff), eq(licenseDocuments.uploadTokenHash, uploadTokenHash)));
  for (const [kind, id] of wanted) {
    if (!rows.some((r) => r.id === id && r.kind === kind)) return `Your ${LICENSE_DOC_LABEL[kind]} copy has expired or is missing. Please upload it again.`;
  }
  return rows;
}

/** Attach checked uploads to the new access request. */
export async function claimLicenseUploads(accessRequestId: string, ids: string[]) {
  if (!ids.length) return;
  await db()
    .update(licenseDocuments)
    .set({ accessRequestId, uploadTokenHash: null })
    .where(and(inArray(licenseDocuments.id, ids), isNull(licenseDocuments.accessRequestId), isNull(licenseDocuments.userId)));
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
