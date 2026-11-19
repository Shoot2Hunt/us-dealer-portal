import { jwtVerify, SignJWT } from "jose";

/** Shared by the proxy (edge) and server code, so it uses only Web APIs. */
export const SESSION_COOKIE = "dp_session";
export const SESSION_DAYS = 7;

export type SessionPayload = { sub: string; role: "dealer" | "brand_admin" | "super_admin" };

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key());
}

export async function readSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return { sub: payload.sub, role: payload.role as SessionPayload["role"] };
  } catch {
    return null;
  }
}
