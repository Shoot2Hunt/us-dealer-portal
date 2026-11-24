import type { UploadedFile } from "@/components/file-field";

/**
 * The request-access form's draft, kept in a cookie so a refresh doesn't lose it.
 *   - Session cookie: deleted when the browser is closed, and when the request is sent.
 *   - Path /request-access: only sent with this page, never with the rest of the site.
 *   - SameSite=Strict: never sent when another site links or posts here.
 * Uploaded files aren't in it, only their names and ids; the files themselves can only be
 * used by this browser (see src/lib/upload-session.ts).
 */
export const DRAFT_COOKIE = "ra_draft";
export const DRAFT_PATH = "/request-access";

export type DraftFields = {
  brandSlug: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  fflNumber: string;
  fflExpires: string;
  sotNumber: string;
  sotExpires: string;
  sendCopy: boolean;
};
export type DraftFiles = { fflFile: UploadedFile | null; sotFile: UploadedFile | null };
export type Draft = { fields: DraftFields; files: DraftFiles };

export const EMPTY_DRAFT: Draft = {
  fields: { brandSlug: "", name: "", phone: "", email: "", company: "", fflNumber: "", fflExpires: "", sotNumber: "", sotExpires: "", sendCopy: true },
  files: { fflFile: null, sotFile: null },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read a draft cookie defensively: anything unexpected is dropped, never trusted. */
export function parseDraft(raw: string | undefined): Draft {
  if (!raw) return EMPTY_DRAFT;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_DRAFT;
  }
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const f = obj(obj(data).fields);
  const str = (k: keyof DraftFields, max = 200) => (typeof f[k] === "string" ? (f[k] as string).slice(0, max) : "");
  const file = (v: unknown): UploadedFile | null => {
    const x = obj(v);
    return typeof x.id === "string" && UUID.test(x.id) && typeof x.fileName === "string" && typeof x.size === "number"
      ? { id: x.id, fileName: x.fileName.slice(0, 120), size: x.size, isPdf: x.isPdf === true }
      : null;
  };
  const files = obj(obj(data).files);
  return {
    fields: {
      brandSlug: str("brandSlug", 60), name: str("name", 100), phone: str("phone", 40), email: str("email", 200), company: str("company", 120),
      fflNumber: str("fflNumber", 40), fflExpires: str("fflExpires", 10), sotNumber: str("sotNumber", 40), sotExpires: str("sotExpires", 10),
      sendCopy: f.sendCopy !== false,
    },
    files: { fflFile: file(files.fflFile), sotFile: file(files.sotFile) },
  };
}

/** Browser only: save the draft (as typed) or clear it. */
export function writeDraftCookie(draft: Draft | null) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const attrs = `; Path=${DRAFT_PATH}; SameSite=Strict${secure}`;
  if (!draft) {
    document.cookie = `${DRAFT_COOKIE}=${attrs}; Max-Age=0`;
    return;
  }
  const value = encodeURIComponent(JSON.stringify(draft));
  // Browsers drop cookies over ~4KB; a draft this size would only come from pasted junk.
  if (value.length > 3800) return;
  document.cookie = `${DRAFT_COOKIE}=${value}${attrs}`;
}
