import { z } from "zod";

/**
 * Phone numbers, checked the same way in the browser (PhoneInput) and on the server.
 * US/Canada numbers need 10 digits (a leading 1 is fine) and are stored as "(208) 555-0123".
 * Numbers starting with + and another country code are kept as +<digits>.
 * An extension may follow: "x12", "ext 12", "ext. 12" or "#12".
 */

export const PHONE_EXAMPLE = "(208) 555-0123";
const EXTENSION = /\s*(?:x|ext\.?|extension|#)\s*(\d{1,6})\s*$/i;

export type PhoneResult = { ok: true; value: string } | { ok: false; error: string };

/** null when empty (the field is optional wherever it's used). */
export function parsePhone(raw: string | null | undefined): PhoneResult | null {
  const input = (raw ?? "").trim();
  if (!input) return null;
  if (input.length > 40) return { ok: false, error: "That phone number is too long." };

  const ext = input.match(EXTENSION);
  const main = ext ? input.slice(0, ext.index).trim() : input;
  if (/[a-z]/i.test(main) || !/^\+?[\d\s().-]+$/.test(main)) {
    return { ok: false, error: `Phone numbers can only contain numbers, spaces and + ( ) - . — for example ${PHONE_EXAMPLE}.` };
  }
  const suffix = ext ? ` x${ext[1]}` : "";
  let digits = main.replace(/\D/g, "");

  // International (not +1): 8–15 digits under the E.164 limit.
  if (main.startsWith("+") && !digits.startsWith("1")) {
    if (digits.length < 8 || digits.length > 15) return { ok: false, error: "International numbers need a country code and 8 to 15 digits, e.g. +44 20 7946 0958." };
    return { ok: true, value: `+${digits}${suffix}` };
  }

  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) {
    return { ok: false, error: `Enter a 10-digit phone number with area code, e.g. ${PHONE_EXAMPLE}. You entered ${digits.length} digit${digits.length === 1 ? "" : "s"}.` };
  }
  // North American numbering: area codes and exchanges never start with 0 or 1.
  if (/^[01]/.test(digits)) return { ok: false, error: "That area code isn't valid — US area codes don't start with 0 or 1." };
  if (/^[01]/.test(digits.slice(3))) return { ok: false, error: "That phone number isn't valid — check the 3 digits after the area code." };
  return { ok: true, value: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}${suffix}` };
}

/**
 * What a phone field should hold after a keystroke or paste, or null to ignore it. US
 * numbers stop at 10 digits (a "+1" in front doesn't count; a pasted 11-digit number starting
 * with 1 has the 1 dropped). International numbers (+ and another code) stop at 15. An
 * extension can still be typed after the number.
 */
export function limitPhoneInput(raw: string): string | null {
  const ext = raw.match(EXTENSION);
  const main = ext ? raw.slice(0, ext.index) : raw;
  const trimmed = main.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) return digits.length > 15 ? null : raw;
  if (trimmed.startsWith("+1")) digits = digits.slice(1);
  else if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1) + (ext ? ` x${ext[1]}` : "");
  return digits.length > 10 ? null : raw;
}

/** Formats a US number while it's being typed: "2085" → "(208) 5". Leaves anything else alone. */
export function formatPhoneAsTyped(raw: string): string {
  if (raw.trim().startsWith("+") && !raw.trim().startsWith("+1")) return raw;
  if (EXTENSION.test(raw) || /[a-z]/i.test(raw)) return raw;
  let digits = raw.replace(/\D/g, "");
  let prefix = "";
  if (digits.length > 10 && digits.startsWith("1")) {
    prefix = raw.trim().startsWith("+") ? "+1 " : "1 ";
    digits = digits.slice(1);
  }
  if (digits.length > 10) return raw;
  if (!digits) return raw.trim() === "+" ? raw : "";
  if (digits.length <= 3) return `${prefix}(${digits}`;
  if (digits.length <= 6) return `${prefix}(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `${prefix}(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Optional phone field for zod schemas: blank → undefined, valid → normalized, else the error. */
export const phoneField = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const r = parsePhone(v);
    if (!r) return undefined;
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.value;
  });
