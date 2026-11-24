import "server-only";
import { getSiteSettings, type SiteSettings } from "@/sanity/content";
import { appUrl, type EmailMessage } from "@/lib/email";

/**
 * Every email the portal sends is built here, with an HTML and a plain-text
 * version. Names, logo and support contact come from Sanity → Portal settings.
 */

type Block =
  | { p: string }
  | { button: { label: string; url: string } }
  | { details: [string, string | null | undefined][] }
  | { list: string[] }
  | { note: string };

type Template = Omit<EmailMessage, "to" | "kind" | "sensitive">;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const INK = "#16181d";
const MUTED = "#646a75";
const LINE = "#e3e5e8";
const PANEL = "#f6f7f8";
const ACCENT = "#b4532a";

function render(s: SiteSettings, opts: { preheader: string; heading: string; blocks: Block[] }): Pick<Template, "html" | "text"> {
  const portal = s.portalName ?? "Dealer Portal";
  const support = [s.supportEmail, s.supportPhone].filter(Boolean).join(" · ");

  const htmlBlocks = opts.blocks
    .map((b) => {
      if ("p" in b) return `<p style="margin:0 0 16px;line-height:1.55">${esc(b.p).replace(/\n/g, "<br>")}</p>`;
      if ("note" in b) return `<p style="margin:0 0 16px;font-size:13px;color:${MUTED};line-height:1.5">${esc(b.note)}</p>`;
      if ("list" in b) return `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6">${b.list.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      if ("button" in b)
        return `<p style="margin:24px 0"><a href="${esc(b.button.url)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px">${esc(b.button.label)}</a></p>
<p style="margin:0 0 16px;font-size:12px;color:${MUTED};word-break:break-all">Or paste this link into your browser: ${esc(b.button.url)}</p>`;
      const rows = b.details
        .filter(([, v]) => v)
        .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:${MUTED};vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;white-space:pre-wrap">${esc(v!)}</td></tr>`)
        .join("");
      return `<table role="presentation" style="width:100%;border-collapse:collapse;background:${PANEL};border-radius:6px;margin:0 0 16px;font-size:14px"><tbody><tr><td style="padding:12px 16px"><table role="presentation" style="border-collapse:collapse">${rows}</table></td></tr></tbody></table>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;background:${PANEL};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<span style="display:none;max-height:0;overflow:hidden">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;border-collapse:collapse">
<tr><td style="padding:0 0 16px;text-align:center">${
    s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="${esc(portal)}" height="40" style="height:40px">` : `<strong style="font-size:18px">${esc(portal)}</strong>`
  }</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:8px;padding:28px 28px 12px;font-size:15px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(opts.heading)}</h1>
${htmlBlocks}
</td></tr>
<tr><td style="padding:16px 8px;text-align:center;font-size:12px;color:${MUTED};line-height:1.5">
${esc(portal)}${support ? ` · Questions? ${esc(support)}` : ""}<br>
<a href="${esc(appUrl("/login"))}" style="color:${ACCENT}">${esc(appUrl("").replace(/^https?:\/\//, ""))}</a>
</td></tr></table></td></tr></table></body></html>`;

  const textBlocks = opts.blocks.map((b) => {
    if ("p" in b) return b.p;
    if ("note" in b) return b.note;
    if ("list" in b) return b.list.map((i) => `- ${i}`).join("\n");
    if ("button" in b) return `${b.button.label}:\n${b.button.url}`;
    return b.details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
  });
  const text = [opts.heading, ...textBlocks, "--", `${portal}${support ? ` · Questions? ${support}` : ""}`, appUrl("/login")].join("\n\n");
  return { html, text };
}

async function build(opts: { subject: string; preheader: string; heading: string; blocks: Block[] }): Promise<Template> {
  const s = await getSiteSettings();
  return { subject: opts.subject, replyTo: s.supportEmail, ...render(s, opts) };
}

// --- Access requests ---

export type RequestSummary = {
  brandName: string;
  name: string;
  email: string;
  company: string;
  phone?: string | null;
  fflNumber: string;
  fflExpires?: string | null;
  hasSot: boolean;
  sotNumber?: string | null;
  sotExpires?: string | null;
  message?: string | null;
  files: { kind: string; fileName: string }[];
};

function requestDetails(r: RequestSummary): Block {
  return {
    details: [
      ["Brand", r.brandName],
      ["Name", r.name],
      ["Business", r.company],
      ["Email", r.email],
      ["Phone", r.phone],
      ["FFL number", r.fflNumber],
      ["FFL expires", r.fflExpires],
      ["SOT number", r.hasSot ? r.sotNumber || "Not given" : "No SOT"],
      ["SOT expires", r.sotExpires],
      ["Files", r.files.length ? r.files.map((f) => `${f.kind.toUpperCase()}: ${f.fileName}`).join("\n") : "None uploaded"],
      ["Message", r.message],
    ],
  };
}

/** To the brand's notification emails and the portal admins (adminNotifyEmails). */
export function accessRequestToAdmins(r: RequestSummary) {
  return build({
    subject: `Dealer access request: ${r.company}`,
    preheader: `${r.name} from ${r.company} asked for access through ${r.brandName}.`,
    heading: "New dealer access request",
    blocks: [
      { p: `${r.name} from ${r.company} asked for dealer portal access through ${r.brandName}.` },
      requestDetails(r),
      { button: { label: "Review the request", url: appUrl("/admin") } },
      { note: "Verify the FFL (and SOT if they hold one) before approving. Uploaded files can be previewed on the review page." },
    ],
  });
}

/** Optional copy for the dealer, when they tick "Email me a copy" on the form. */
export function accessRequestCopy(r: RequestSummary) {
  return build({
    subject: `Your dealer access request to ${r.brandName}`,
    preheader: "Here's a copy of the request you sent.",
    heading: "We received your request",
    blocks: [
      { p: `Hi ${r.name},` },
      { p: `Thanks for requesting dealer access through ${r.brandName}. Their team will verify your license and get back to you, usually within one or two business days. Here's a copy of what you sent:` },
      requestDetails(r),
      { p: "Once you're approved, you'll get another email with a link to set your password." },
      { note: "Didn't send this request? You can ignore this email, or reply to let us know." },
    ],
  });
}

export function accessDenied(p: { name: string; brandName: string }) {
  return build({
    subject: `Your dealer access request to ${p.brandName}`,
    preheader: "An update on your dealer portal request.",
    heading: "About your access request",
    blocks: [
      { p: `Hi ${p.name},` },
      { p: `Thanks for your interest in becoming a ${p.brandName} dealer. We weren't able to approve your portal access at this time.` },
      { p: "If you think this was a mistake, or your license details have changed, reply to this email and we'll take another look." },
    ],
  });
}

// --- Onboarding ---

/** Sent when a request is approved. Contains the one-time set-password link. */
export async function welcomeApproved(p: { name: string; brandName: string; setPasswordUrl: string }) {
  const s = await getSiteSettings();
  const portal = s.portalName ?? "the dealer portal";
  return build({
    subject: `Welcome to ${portal}: set your password`,
    preheader: `${p.brandName} approved your dealer account.`,
    heading: "You're approved. Welcome aboard!",
    blocks: [
      { p: `Hi ${p.name},` },
      { p: `Good news: ${p.brandName} approved your dealer account. Set a password to sign in. The link works once and expires in 7 days.` },
      { button: { label: "Set your password", url: p.setPasswordUrl } },
      { p: "Once you're in, you can:" },
      {
        list: [
          "See live dealer pricing and stock across all our brands",
          "Order from several brands in one checkout",
          "Pay by card, ACH or check, or split one order across methods",
          "Track every order and its shipping status",
        ],
      },
      ...(s.welcomeMessage ? [{ p: s.welcomeMessage }] : []),
      { note: "Keep your FFL (and SOT, if you have one) current. Orders are blocked when the license on file has expired." },
    ],
  });
}

/** Sent after a dealer sets their password for the first time. */
export async function accountReady(p: { name: string }) {
  return build({
    subject: "Your dealer account is ready",
    preheader: "You're all set. Here's how to get started.",
    heading: "You're all set",
    blocks: [
      { p: `Hi ${p.name},` },
      { p: "Your password is saved and your dealer account is ready to use. A few places to start:" },
      { details: [["Inventory", appUrl("/inventory")], ["Your orders", appUrl("/orders")], ["Sign in", appUrl("/login")]] },
      { button: { label: "Browse inventory", url: appUrl("/inventory") } },
      { note: "Forgot your password later? Use the \"Forgot password\" link on the sign-in page." },
    ],
  });
}

/** Sent to new brand/super admins created on the Dealers page. */
export function adminInvite(p: { name: string; setPasswordUrl: string }) {
  return build({
    subject: "You've been added as a dealer portal admin",
    preheader: "Set your password to get started.",
    heading: "You're an admin on the dealer portal",
    blocks: [
      { p: `Hi ${p.name},` },
      { p: "You've been added as an admin. Set a password to sign in. The link expires in 7 days." },
      { button: { label: "Set your password", url: p.setPasswordUrl } },
    ],
  });
}

/** "Send password link" on the Dealers page. */
export function setupLinkResent(p: { name: string; setPasswordUrl: string }) {
  return build({
    subject: "Your new dealer portal password link",
    preheader: "Here's a new link to set your password.",
    heading: "Set your password",
    blocks: [
      { p: `Hi ${p.name},` },
      { p: "Here's a new link to set your dealer portal password. It works once and expires in 7 days. Any older links no longer work." },
      { button: { label: "Set your password", url: p.setPasswordUrl } },
    ],
  });
}

// --- Passwords ---

export function passwordReset(p: { name: string; resetUrl: string; minutes: number }) {
  return build({
    subject: "Reset your dealer portal password",
    preheader: `This link expires in ${p.minutes} minutes.`,
    heading: "Reset your password",
    blocks: [
      { p: `Hi ${p.name},` },
      { p: `We got a request to reset your password. The link works once and expires in ${p.minutes} minutes.` },
      { button: { label: "Choose a new password", url: p.resetUrl } },
      { note: "Didn't ask for this? You can ignore this email. Your password won't change unless you open the link and choose a new one." },
    ],
  });
}

export function passwordChanged(p: { name: string }) {
  return build({
    subject: "Your dealer portal password was changed",
    preheader: "If this was you, there's nothing else to do.",
    heading: "Your password was changed",
    blocks: [
      { p: `Hi ${p.name},` },
      { p: `Your dealer portal password was just changed (${new Date().toUTCString()}). If this was you, there's nothing else to do.` },
      { p: "If you didn't change it, reset your password right away and reply to this email so we can secure your account." },
      { button: { label: "Reset password", url: appUrl("/forgot-password") } },
    ],
  });
}

// --- Two-step verification ---

export function twoFactorEnabled(p: { name: string }) {
  return build({
    subject: "Two-step verification is on",
    preheader: "Your account now asks for a code from your authenticator app.",
    heading: "Two-step verification is on",
    blocks: [
      { p: `Hi ${p.name},` },
      { p: `Two-step verification was turned on for your dealer portal account (${new Date().toUTCString()}). From now on, signing in asks for a code from your authenticator app as well as your password.` },
      { note: "Keep your recovery codes somewhere safe. If you lose your phone, a recovery code is how you get back in." },
      { p: "Didn't do this? Reset your password right away and reply to this email." },
    ],
  });
}

export function twoFactorDisabled(p: { name: string; byAdmin: boolean }) {
  return build({
    subject: "Two-step verification was turned off",
    preheader: "Your account no longer asks for an authenticator code.",
    heading: "Two-step verification is off",
    blocks: [
      { p: `Hi ${p.name},` },
      {
        p: p.byAdmin
          ? "At your request, our team turned off two-step verification on your dealer portal account. You'll sign in with just your password until you turn it back on."
          : `Two-step verification was turned off for your dealer portal account (${new Date().toUTCString()}).`,
      },
      { button: { label: "Turn it back on", url: appUrl("/account#two-factor") } },
      { p: "Didn't expect this? Reset your password right away and reply to this email." },
    ],
  });
}

export function recoveryCodeUsed(p: { name: string; left: number }) {
  return build({
    subject: "A recovery code was used to sign in",
    preheader: `You have ${p.left} recovery code${p.left === 1 ? "" : "s"} left.`,
    heading: "A recovery code was used",
    blocks: [
      { p: `Hi ${p.name},` },
      { p: `Someone signed in to your dealer portal account with one of your recovery codes (${new Date().toUTCString()}). You have ${p.left} left.` },
      ...(p.left <= 3 ? [{ p: "You're running low. Create a new set on your account page." } as Block] : []),
      { button: { label: "Manage two-step verification", url: appUrl("/account#two-factor") } },
      { p: "Wasn't you? Reset your password right away and reply to this email." },
    ],
  });
}
