import "server-only";
import { headers } from "next/headers";
import { auditLog, db, type User } from "@/lib/db";
import { reportError } from "@/lib/errors";

/**
 * Record an admin action. Never throws: an audit write failing is reported, but must not
 * undo or block the action itself.
 */
export async function audit(actor: User, action: string, target?: string, details?: Record<string, unknown>) {
  try {
    const h = await headers();
    await db().insert(auditLog).values({
      actorId: actor.id,
      actorEmail: actor.email,
      action,
      target,
      details,
      ip: (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null)?.slice(0, 64) ?? null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    });
  } catch (err) {
    reportError("audit log", err, { action, target });
  }
}
