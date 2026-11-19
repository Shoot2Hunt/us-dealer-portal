import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** WooCommerce signs the raw body: base64(HMAC-SHA256(body, secret)). The mu-plugin uses the same scheme. */
export function verifyWooSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
