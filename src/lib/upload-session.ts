import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { DRAFT_COOKIE, DRAFT_PATH } from "@/app/(site)/(auth)/request-access/draft";

/**
 * A private, per-browser key for the request-access form. Copies uploaded before the
 * request is sent are tagged with its hash, so only the browser that uploaded them can
 * attach them. HttpOnly (page scripts can't read it) and a session cookie: it ends when
 * the browser is closed.
 */
const COOKIE = "ra_upload";
const hash = (token: string) => createHash("sha256").update(token).digest("base64url");

const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/" };

/** The current browser's upload key hash, creating the cookie on first upload. */
export async function uploadTokenHash(create: true): Promise<string>;
export async function uploadTokenHash(create?: false): Promise<string | null>;
export async function uploadTokenHash(create = false): Promise<string | null> {
  const jar = await cookies();
  let token = jar.get(COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    if (!create) return null;
    token = randomBytes(32).toString("base64url");
    jar.set(COOKIE, token, cookieOptions);
  }
  return hash(token);
}

/** After the request is sent: forget the upload key and the saved draft. */
export async function endRequestAccessSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete({ name: DRAFT_COOKIE, path: DRAFT_PATH });
}
