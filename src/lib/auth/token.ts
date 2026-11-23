import { jwtVerify, SignJWT } from "jose";

/** Shared by the proxy (edge) and server code, so it uses only Web APIs. */
export const SESSION_COOKIE = "dp_session";
export const SESSION_DAYS = 7;

/** Set after a correct password when the account has two-step verification on. */
export const TWO_FACTOR_COOKIE = "dp_2fa";
export const TWO_FACTOR_MINUTES = 10;

export type SessionPayload = {
  sub: string;
  role: "dealer" | "brand_admin" | "super_admin";
  /** users.sessionVersion when issued. Bumping it signs the user out everywhere. */
  v?: number;
};

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

/** `days` comes from Sanity → Security; the proxy only checks the signature and expiry. */
export async function signSession(payload: SessionPayload, days = SESSION_DAYS): Promise<string> {
  return new SignJWT({ role: payload.role, v: payload.v ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(key());
}

export async function readSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    // A two-step ticket is not a session.
    if (!payload.sub || payload.purpose) return null;
    return { sub: payload.sub, role: payload.role as SessionPayload["role"], v: typeof payload.v === "number" ? payload.v : 0 };
  } catch {
    return null;
  }
}

export type TwoFactorTicket = { sub: string; v: number; next: string };

export async function signTwoFactorTicket(t: TwoFactorTicket): Promise<string> {
  return new SignJWT({ purpose: "2fa", v: t.v, next: t.next })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(t.sub)
    .setIssuedAt()
    .setExpirationTime(`${TWO_FACTOR_MINUTES}m`)
    .sign(key());
}

export async function readTwoFactorTicket(token: string | undefined): Promise<TwoFactorTicket | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (!payload.sub || payload.purpose !== "2fa") return null;
    return { sub: payload.sub, v: Number(payload.v ?? 0), next: typeof payload.next === "string" ? payload.next : "" };
  } catch {
    return null;
  }
}
