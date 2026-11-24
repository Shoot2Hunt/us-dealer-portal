"use server";

import { headers } from "next/headers";
import { sign, stampAge } from "./stamp";
import { z } from "zod";
import { phoneField } from "@/lib/phone";
import { getCurrentUser } from "@/lib/auth/session";
import { CONTACT_TOPICS } from "@/lib/contact";
import { adminNotifyEmails, appUrl, sendEmail } from "@/lib/email";
import { reportError } from "@/lib/errors";
import { getSiteSettings } from "@/sanity/content";
import { sanityWriter } from "@/sanity/write";
import { rateLimit } from "@/lib/rate-limit";

export type ContactState = { ok?: boolean; error?: string } | undefined;

/** At most this many messages per network per hour. */
const HOURLY_LIMIT = 5;
/** Real people take longer than this to fill in the form; bots usually don't. */
const MIN_FILL_MS = 3000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: z.email("Enter a valid email address").max(200).transform((s) => s.toLowerCase()),
  company: z.string().trim().max(120).optional(),
  phone: phoneField,
  topic: z.enum(CONTACT_TOPICS.map((t) => t.value) as [string, ...string[]]),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters)").max(5000, "Keep it under 5,000 characters"),
});

export async function sendContactMessage(_: ContactState, form: FormData): Promise<ContactState> {
  // Honeypot: a field people never see. Anything in it means a bot; pretend it worked.
  if (String(form.get("website") ?? "")) return { ok: true };
  const age = stampAge(String(form.get("stamp") ?? ""));
  if (age === null || age > MAX_FORM_AGE_MS) return { error: "This form expired. Please reload the page and try again." };
  if (age < MIN_FILL_MS) return { ok: true };

  const parsed = schema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    company: form.get("company") || undefined,
    phone: form.get("phone") || undefined,
    topic: form.get("topic"),
    message: form.get("message"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const m = parsed.data;

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const ipHash = sign(`ip|${ip}`).slice(0, 24);
  // Works even when Sanity isn't configured (the Sanity-side count below is a second check).
  const limit = await rateLimit(`contact:${ipHash}`, HOURLY_LIMIT, 60);
  if (!limit.ok) return { error: "You've sent several messages recently. Please wait a while, or email us directly." };
  const [user, settings] = await Promise.all([getCurrentUser(), getSiteSettings()]);
  const writer = sanityWriter();

  let savedId: string | null = null;
  try {
    if (writer) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recent = await writer.fetch<number>(`count(*[_type == "contactSubmission" && ipHash == $ipHash && submittedAt > $since])`, { ipHash, since });
      if (recent >= HOURLY_LIMIT) return { error: "You've sent several messages recently. Please wait a while, or email us directly." };
      const doc = await writer.create({
        _type: "contactSubmission",
        status: "new",
        submittedAt: new Date().toISOString(),
        ...m,
        isDealer: Boolean(user),
        page: "/contact",
        ipHash,
      });
      savedId = doc._id;
    }
  } catch (err) {
    reportError("contact form save", err);
  }

  // Email whoever handles messages, even if saving to Sanity failed.
  const to = [...new Set([...(await adminNotifyEmails()), settings.supportEmail].filter((x): x is string => Boolean(x)))];
  let emailed = false;
  if (to.length) {
    const topic = CONTACT_TOPICS.find((t) => t.value === m.topic)?.title ?? m.topic;
    const result = await sendEmail({
      to,
      kind: "contact.message",
      replyTo: m.email,
      subject: `Contact form: ${topic} from ${m.name}`,
      text: [
        `${m.name} <${m.email}>${m.company ? ` · ${m.company}` : ""}${m.phone ? ` · ${m.phone}` : ""}`,
        user ? `Signed-in ${user.role === "dealer" ? "dealer" : "admin"} account.` : "Not signed in.",
        `Topic: ${topic}`,
        "",
        m.message,
        "",
        savedId ? `Manage it in Studio → Inbox: ${appUrl("/studio")}` : "",
      ].join("\n"),
    }).catch((err) => {
      reportError("contact form email", err);
      return { ok: false as const };
    });
    emailed = result.ok;
  }

  if (!savedId && !emailed) {
    reportError("contact form", "Message could not be saved or emailed: set SANITY_API_WRITE_TOKEN and/or ADMIN_NOTIFY_EMAIL");
    return { error: `We couldn't send your message right now.${settings.supportEmail ? ` Please email ${settings.supportEmail} instead.` : " Please try again later."}` };
  }
  return { ok: true };
}
