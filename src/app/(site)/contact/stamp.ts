import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Signs values for the contact form (form-opened time, hashed IP) with the app secret. */
export const sign = (value: string) => createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`contact|${value}`).digest("base64url");

/** Stamped into the form when it's rendered, so a submission can prove when the form was opened. */
export function formStamp(): string {
  const t = String(Date.now());
  return `${t}.${sign(t)}`;
}

/** Milliseconds since the form was rendered, or null if the stamp was tampered with. */
export function stampAge(stamp: string): number | null {
  const [t, mac] = stamp.split(".");
  if (!t || !mac) return null;
  const expected = Buffer.from(sign(t));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Date.now() - Number(t);
}
