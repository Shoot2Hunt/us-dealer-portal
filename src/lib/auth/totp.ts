import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Two-step verification with an authenticator app (Google Authenticator, 1Password,
 * Authy, Microsoft Authenticator…). Standard TOTP: RFC 6238, SHA-1, 6 digits, 30 seconds.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
/** Accept the previous and next code too, for phones whose clocks drift a little. */
const DRIFT_STEPS = 1;

// --- Base32 (RFC 4648), which authenticator apps expect for the secret ---

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret, base32 (160 bits, as RFC 4226 recommends). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const n = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Check a 6-digit code. Returns the matching time step (so the caller can store it
 * and refuse the same code again), or null if it doesn't match.
 */
export function verifyTotp(secret: string, code: string, lastUsedStep?: number | null, now = Date.now()): number | null {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const step = currentStep(now);
  for (let d = -DRIFT_STEPS; d <= DRIFT_STEPS; d++) {
    const s = step + d;
    if (lastUsedStep != null && s <= lastUsedStep) continue; // already used
    if (timingSafeEqual(Buffer.from(totpCode(secret, s)), Buffer.from(digits))) return s;
  }
  return null;
}

/** The otpauth:// URI that authenticator apps read from the QR code. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

// --- Encryption at rest (AES-256-GCM, key derived from SESSION_SECRET) ---

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return createHash("sha256").update(`dealer-portal:totp:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized 2FA secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// --- Recovery codes (one-time, for a lost phone) ---

export const RECOVERY_CODE_COUNT = 10;
const RC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i

const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
export const hashRecoveryCode = (code: string) => createHash("sha256").update(normalizeRecovery(code)).digest("hex");

/** New codes like "k7mq-x2rd-9fhp". Store only the hashes. */
export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => RC_ALPHABET[randomInt(RC_ALPHABET.length)]).join("")).join("-"),
  );
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** Recovery codes are 12 letters/digits; TOTP codes are 6 digits. */
export const looksLikeRecoveryCode = (code: string) => normalizeRecovery(code).length === 12;
