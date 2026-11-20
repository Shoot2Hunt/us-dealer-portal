import "server-only";
import { eq } from "drizzle-orm";
import { db, emailLog } from "@/lib/db";
import { errorMessage, reportError } from "@/lib/errors";

export type EmailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** Where replies go (usually the support address from Sanity). */
  replyTo?: string;
  /** Short label for the email log, e.g. "password.reset". */
  kind?: string;
  /** Contains a password link: don't store the body, and never resend it as-is. */
  sensitive?: boolean;
};

export type EmailResult = { ok: true; id?: string } | { ok: false; error: string };

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Delivery = { status: "sent" | "failed" | "logged"; attempts: number; providerId?: string; error?: string };

/** Talk to the provider (Resend), retrying network errors, rate limits and 5xx responses. */
async function deliver(to: string[], msg: Pick<EmailMessage, "subject" | "text" | "html" | "replyTo">): Promise<Delivery> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      return { status: "failed", attempts: 0, error: "RESEND_API_KEY is not set, so no email can be sent." };
    }
    console.log(`[email] (not sent: no RESEND_API_KEY) to=${to.join(", ")} subject=${msg.subject}\n${msg.text}`);
    return { status: "logged", attempts: 0 };
  }

  let error = "Unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ?? "Dealer Portal <no-reply@example.com>",
          to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          reply_to: msg.replyTo || undefined,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as { id?: string };
        return { status: "sent", attempts: attempt, providerId: json.id };
      }
      error = `Email provider returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`;
      // 4xx other than rate limiting means the message itself is wrong; retrying won't help.
      if (res.status < 500 && res.status !== 429) return { status: "failed", attempts: attempt, error };
    } catch (err) {
      error = `Could not reach the email provider: ${errorMessage(err)}`;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(500 * 3 ** (attempt - 1));
  }
  return { status: "failed", attempts: MAX_ATTEMPTS, error };
}

/**
 * Send an email. Never throws: a failed email must not break signup, approval
 * or checkout. Every attempt is recorded in email_log and failures show up on
 * /admin/emails, where they can be retried.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).map((s) => s.trim()).filter(Boolean);
  if (!to.length) return { ok: false, error: "No recipients" };

  let result: Delivery;
  try {
    result = await deliver(to, msg);
  } catch (err) {
    result = { status: "failed", attempts: 0, error: errorMessage(err) };
  }
  if (result.status === "failed") reportError(`email ${msg.kind ?? "general"}`, result.error, { to, subject: msg.subject });

  try {
    await db().insert(emailLog).values({
      kind: msg.kind ?? "general",
      to,
      subject: msg.subject,
      status: result.status,
      attempts: result.attempts,
      providerId: result.providerId,
      error: result.error,
      body: msg.sensitive ? null : { text: msg.text, html: msg.html, replyTo: msg.replyTo },
    });
  } catch (err) {
    // Logging must never be the reason an email "fails".
    reportError("email log insert", err);
  }

  return result.status === "failed" ? { ok: false, error: result.error ?? "Send failed" } : { ok: true, id: result.providerId };
}

/** Re-send a logged email exactly as it was. Used by the Retry button on /admin/emails. */
export async function resendLoggedEmail(id: number): Promise<EmailResult> {
  const [row] = await db().select().from(emailLog).where(eq(emailLog.id, id));
  if (!row) return { ok: false, error: "Email not found" };
  if (!row.body) return { ok: false, error: "This email held a password link. Send a fresh link from the Dealers page instead." };
  const result = await deliver(row.to, { subject: row.subject, ...row.body });
  await db()
    .update(emailLog)
    .set({ status: result.status, attempts: row.attempts + result.attempts, providerId: result.providerId ?? row.providerId, error: result.error ?? null, updatedAt: new Date() })
    .where(eq(emailLog.id, id));
  return result.status === "failed" ? { ok: false, error: result.error ?? "Send failed" } : { ok: true, id: result.providerId };
}

export function appUrl(path = "") {
  const base = process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}${path}`;
}
