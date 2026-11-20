import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Log an unexpected server error with a short reference code. Show the code to
 * the user ("Reference: 7KQ2-M9XD") so support can find the matching entry in
 * the server logs (Vercel → Logs, search for the code).
 */
export function reportError(scope: string, err: unknown, extra?: Record<string, unknown>): string {
  const ref = randomBytes(4).toString("hex").toUpperCase().replace(/^(.{4})/, "$1-");
  const detail = err instanceof Error ? { message: err.message, stack: err.stack } : { value: String(err) };
  console.error(`[error] ${scope} ref=${ref}`, JSON.stringify({ ...detail, ...extra }));
  return ref;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
