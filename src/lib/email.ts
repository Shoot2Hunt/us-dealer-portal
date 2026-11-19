import "server-only";

/**
 * Sends email through Resend when RESEND_API_KEY is set; otherwise logs it
 * (handy in development). Swap in any provider here.
 */
export async function sendEmail(msg: { to: string | string[]; subject: string; text: string }) {
  const to = Array.isArray(msg.to) ? msg.to.filter(Boolean) : [msg.to];
  if (!to.length) return;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email] to=${to.join(", ")} subject=${msg.subject}\n${msg.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Dealer Portal <no-reply@example.com>", to, subject: msg.subject, text: msg.text }),
  });
  if (!res.ok) console.error("[email] send failed", res.status, await res.text());
}

export function appUrl(path = "") {
  const base = process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}${path}`;
}
