import "server-only";
import { and, eq } from "drizzle-orm";
import { db, emailLog, users } from "@/lib/db";
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
/** A single plain address: no spaces, angle brackets, commas or line breaks. */
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Delivery = { status: "sent" | "failed" | "logged"; attempts: number; providerId?: string; error?: string };

type OutgoingMessage = Pick<EmailMessage, "subject" | "text" | "html" | "replyTo">;

/**
 * The configured email provider. Mailgun when MAILGUN_API_KEY and MAILGUN_DOMAIN are set
 * (MAILGUN_REGION=eu for EU accounts), else Resend with RESEND_API_KEY, else none.
 */
export function emailProvider(): { name: "mailgun" | "resend"; request: (to: string[], msg: OutgoingMessage) => Request } | null {
  const mgKey = process.env.MAILGUN_API_KEY?.trim();
  const mgDomain = process.env.MAILGUN_DOMAIN?.trim();
  if (mgKey && mgDomain) {
    const host = process.env.MAILGUN_REGION?.trim().toLowerCase() === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
    const from = process.env.EMAIL_FROM?.trim() || `Dealer Portal <no-reply@${mgDomain}>`;
    return {
      name: "mailgun",
      request: (to, msg) => {
        const body = new URLSearchParams({ from, subject: msg.subject, text: msg.text });
        for (const addr of to) body.append("to", addr);
        if (msg.html) body.set("html", msg.html);
        if (msg.replyTo) body.set("h:Reply-To", msg.replyTo);
        return new Request(`https://${host}/v3/${encodeURIComponent(mgDomain)}/messages`, {
          method: "POST",
          headers: { Authorization: `Basic ${Buffer.from(`api:${mgKey}`).toString("base64")}` },
          body,
        });
      },
    };
  }
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    return {
      name: "resend",
      request: (to, msg) =>
        new Request("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM ?? "Dealer Portal <no-reply@example.com>",
            to,
            subject: msg.subject,
            text: msg.text,
            html: msg.html,
            reply_to: msg.replyTo || undefined,
          }),
        }),
    };
  }
  return null;
}

/** Talk to the provider, retrying network errors, rate limits and 5xx responses. */
async function deliver(to: string[], msg: OutgoingMessage): Promise<Delivery> {
  const provider = emailProvider();
  if (!provider) {
    if (process.env.NODE_ENV === "production") {
      return { status: "failed", attempts: 0, error: "No email provider is set up (MAILGUN_API_KEY + MAILGUN_DOMAIN, or RESEND_API_KEY), so no email can be sent." };
    }
    console.log(`[email] (not sent: no email provider set up) to=${to.join(", ")} subject=${msg.subject}\n${msg.text}`);
    return { status: "logged", attempts: 0 };
  }

  let error = "Unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // A fresh request each attempt: a request body can only be sent once.
      const res = await fetch(provider.request(to, msg), { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as { id?: string };
        return { status: "sent", attempts: attempt, providerId: json.id };
      }
      error = `${provider.name === "mailgun" ? "Mailgun" : "Resend"} returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`;
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
export async function sendEmail(input: EmailMessage): Promise<EmailResult> {
  // Header hygiene for anything built from user input (names, company, contact form):
  // no line breaks in the subject (SMTP header injection), and only real addresses.
  const msg: EmailMessage = {
    ...input,
    subject: input.subject.replace(/[\r\n\t]+/g, " ").trim().slice(0, 250),
    replyTo: input.replyTo && EMAIL.test(input.replyTo.trim()) ? input.replyTo.trim() : undefined,
  };
  const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).map((s) => s.trim()).filter((s) => EMAIL.test(s));
  if (!to.length) return { ok: false, error: "No valid recipients" };

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

/**
 * Who gets admin alerts (new access requests, orders that need attention, payments):
 * ADMIN_NOTIFY_EMAIL (one address, or several separated by commas), else every active
 * super admin, so alerts never silently go nowhere.
 */
export async function adminNotifyEmails(): Promise<string[]> {
  const configured = (process.env.ADMIN_NOTIFY_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.length) return configured;
  try {
    const rows = await db()
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.role, "super_admin"), eq(users.status, "active")));
    return rows.map((r) => r.email);
  } catch (err) {
    reportError("admin notify emails", err);
    return [];
  }
}
