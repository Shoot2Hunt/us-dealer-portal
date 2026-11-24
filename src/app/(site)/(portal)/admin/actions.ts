"use server";

import { revalidatePath } from "next/cache";
import { and, eq, or } from "drizzle-orm";
import { accessRequests, db, licenseDocuments, orderLines, orders, payments, storeOrders, users, type User } from "@/lib/db";
import { issueSetupToken, requireAdmin, signOutOtherSessions } from "@/lib/auth/session";
import { CLEARED_TWO_FACTOR } from "@/lib/auth/two-factor";
import { appUrl, resendLoggedEmail, sendEmail, type EmailMessage } from "@/lib/email";
import { accessDenied, adminInvite, setupLinkResent, twoFactorDisabled, welcomeApproved } from "@/lib/email-templates";
import { errorMessage } from "@/lib/errors";
import { releaseIfPaid } from "@/lib/orders";
import { createWooOrder } from "@/lib/woo/orders";
import { isStoreKey, storeName } from "@/lib/woo/stores";
import { syncStore } from "@/lib/woo/sync";
import { z } from "zod";
import { audit } from "@/lib/audit";

function canManageBrand(admin: User, brandSlug: string) {
  return admin.role === "super_admin" || admin.brandSlug === brandSlug;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A yyyy-mm-dd date from a form, or null. Anything else is dropped rather than stored. */
const formDate = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};

/**
 * Issue a fresh 7-day set-password link and email it using the given template.
 * Failures are recorded in the email log (/admin/emails) rather than thrown.
 */
async function sendSetupLink(user: User, kind: string, template: (setPasswordUrl: string) => Promise<Omit<EmailMessage, "to">>) {
  const token = await issueSetupToken(user.id);
  return sendEmail({ to: user.email, kind, sensitive: true, ...(await template(appUrl(`/set-password?token=${token}`))) });
}

export async function approveRequest(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("id"));
  if (!UUID.test(id)) return;
  const [req] = await db().select().from(accessRequests).where(eq(accessRequests.id, id));
  if (!req || req.status !== "pending" || !canManageBrand(admin, req.brandSlug)) return;

  const sotVerified = form.get("sotVerified") === "on";
  const sotExpires = formDate(form.get("sotExpires"));
  const [existing] = await db().select().from(users).where(eq(users.email, req.email));
  // Anyone can submit a request with any email. Never let one touch an admin account.
  if (existing && existing.role !== "dealer") return;
  const [user] = existing
    ? await db().update(users).set({ status: "active", fflNumber: req.fflNumber, fflExpires: req.fflExpires, sotVerified, sotExpires }).where(eq(users.id, existing.id)).returning()
    : await db()
        .insert(users)
        .values({
          email: req.email, name: req.name, company: req.company, phone: req.phone, role: "dealer",
          fflNumber: req.fflNumber, fflExpires: req.fflExpires, sotVerified, sotExpires, approvedBy: admin.id,
        })
        .returning();
  await db().update(accessRequests).set({ status: "approved", handledBy: admin.id, handledAt: new Date() }).where(eq(accessRequests.id, id));
  // The FFL/SOT copies now belong to the dealer, so they can view their own files.
  await db().update(licenseDocuments).set({ userId: user.id }).where(eq(licenseDocuments.accessRequestId, id));
  await sendSetupLink(user, "onboarding.welcome", (setPasswordUrl) => welcomeApproved({ name: user.name, brandName: storeName(req.brandSlug), setPasswordUrl }));
  await audit(admin, "access_request.approve", `user:${user.id}`, { requestId: id, brand: req.brandSlug, email: req.email, sotVerified });
  revalidatePath("/admin");
}

export async function denyRequest(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("id"));
  if (!UUID.test(id)) return;
  const [req] = await db().select().from(accessRequests).where(eq(accessRequests.id, id));
  if (!req || !canManageBrand(admin, req.brandSlug)) return;
  await db().update(accessRequests).set({ status: "denied", handledBy: admin.id, handledAt: new Date() }).where(eq(accessRequests.id, id));
  if (form.get("notify") === "on") {
    await sendEmail({ to: req.email, kind: "access_request.denied", ...(await accessDenied({ name: req.name, brandName: storeName(req.brandSlug) })) });
  }
  await audit(admin, "access_request.deny", `request:${id}`, { brand: req.brandSlug, email: req.email });
  revalidatePath("/admin");
}

/**
 * Licence dates, SOT verification, brand access and suspension. Super admins only: these
 * decide what a dealer may legally order, across every brand.
 */
export async function updateDealer(form: FormData) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return;
  const id = String(form.get("id"));
  if (!UUID.test(id)) return;
  const brands = form.getAll("allowedBrands").map(String).filter(isStoreKey);
  // Net terms: whole days 1–180, credit limit in dollars. Blank = no terms / no limit.
  const termsRaw = String(form.get("paymentTermsDays") ?? "").trim();
  const termsDays = /^\d{1,3}$/.test(termsRaw) && Number(termsRaw) >= 1 && Number(termsRaw) <= 180 ? Number(termsRaw) : null;
  const limitRaw = String(form.get("creditLimit") ?? "").replace(/[$,\s]/g, "");
  const creditLimit = /^\d{1,9}(\.\d{1,2})?$/.test(limitRaw) ? Number(limitRaw).toFixed(2) : null;
  const changes = {
    paymentTermsDays: termsDays,
    creditLimit: termsDays === null ? null : creditLimit,
    status: form.get("status") === "suspended" ? ("suspended" as const) : ("active" as const),
    fflExpires: formDate(form.get("fflExpires")),
    sotVerified: form.get("sotVerified") === "on",
    sotExpires: formDate(form.get("sotExpires")),
    allowedBrands: brands.length ? brands : null,
  };
  const [updated] = await db().update(users).set(changes).where(and(eq(users.id, id), eq(users.role, "dealer"))).returning({ id: users.id });
  if (updated) await audit(admin, "dealer.update", `user:${id}`, changes);
  revalidatePath("/admin/dealers");
}

/** Brand admins may resend links to dealers; only super admins to other admins. */
export async function resendSetupLink(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("id"));
  if (!UUID.test(id)) return;
  const [user] = await db().select().from(users).where(eq(users.id, id));
  if (!user || (user.role !== "dealer" && admin.role !== "super_admin")) return;
  await sendSetupLink(user, "onboarding.setup_link", (setPasswordUrl) => setupLinkResent({ name: user.name, setPasswordUrl }));
  await audit(admin, "user.resend_setup_link", `user:${id}`);
}

/**
 * For someone who lost their phone and their recovery codes. Super admins only: turns off
 * two-step verification, signs the user out everywhere, and emails them about it.
 */
export async function resetTwoFactor(form: FormData) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return;
  const id = String(form.get("id"));
  if (!UUID.test(id) || id === admin.id) return; // use your own account page for yourself
  const [user] = await db().select().from(users).where(eq(users.id, id));
  if (!user?.totpEnabledAt) return;
  await signOutOtherSessions(user.id, CLEARED_TWO_FACTOR);
  await sendEmail({ to: user.email, kind: "2fa.disabled", ...(await twoFactorDisabled({ name: user.name, byAdmin: true })) });
  await audit(admin, "user.reset_2fa", `user:${id}`, { email: user.email });
  revalidatePath("/admin/dealers");
}

const newAdminSchema = z.object({
  email: z.email().max(200).transform((s) => s.toLowerCase()),
  name: z.string().trim().min(2).max(100),
});

export async function createAdmin(form: FormData) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return;
  const parsed = newAdminSchema.safeParse({ email: String(form.get("email") ?? "").trim(), name: form.get("name") });
  if (!parsed.success) return;
  const role = form.get("role") === "super_admin" ? "super_admin" : "brand_admin";
  const brandSlug = String(form.get("brandSlug") ?? "");
  // A brand admin must belong to a brand, or they'd see nothing (and could be mistaken for global).
  if (role === "brand_admin" && !isStoreKey(brandSlug)) return;
  const [user] = await db()
    .insert(users)
    .values({
      email: parsed.data.email,
      name: parsed.data.name,
      role,
      brandSlug: role === "brand_admin" ? brandSlug : null,
      approvedBy: admin.id,
    })
    .onConflictDoNothing()
    .returning();
  if (user) {
    await sendSetupLink(user, "onboarding.admin_invite", (setPasswordUrl) => adminInvite({ name: user.name, setPasswordUrl }));
    await audit(admin, "admin.create", `user:${user.id}`, { email: user.email, role, brandSlug: user.brandSlug });
  }
  revalidatePath("/admin/dealers");
}

/**
 * Marking a check received releases every brand's part of the order to ship, so it is a
 * super-admin (finance) action, not something one brand's admin can do for all brands.
 */
export async function markCheckReceived(form: FormData) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return;
  const paymentId = Number(form.get("paymentId"));
  if (!Number.isSafeInteger(paymentId)) return;
  // A check for an order waiting on one, or a check mailed in for an invoice (net terms).
  const [p] = await db()
    .update(payments)
    .set({ method: "check", status: "received", updatedAt: new Date() })
    .where(
      and(
        eq(payments.id, paymentId),
        or(and(eq(payments.method, "check"), eq(payments.status, "awaiting_check")), and(eq(payments.method, "terms"), eq(payments.status, "invoiced"))),
      ),
    )
    .returning();
  if (p) {
    await audit(admin, "payment.check_received", `payment:${p.id}`, { orderId: p.orderId, amount: p.amount });
    await releaseIfPaid(p.orderId);
  }
  revalidatePath(`/admin/orders/${p?.orderId}`);
}

/** Retry sending one brand's part of an order to WooCommerce (after a failure at checkout). */
export async function retryStoreOrder(form: FormData) {
  const admin = await requireAdmin();
  const storeOrderId = Number(form.get("storeOrderId"));
  if (!Number.isSafeInteger(storeOrderId)) return;
  const [so] = await db().select().from(storeOrders).where(eq(storeOrders.id, storeOrderId));
  if (!so || so.wooOrderId || !isStoreKey(so.store) || !canManageBrand(admin, so.store)) return;
  const [order] = await db().select().from(orders).where(eq(orders.id, so.orderId));
  const [dealer] = await db().select().from(users).where(eq(users.id, order.userId));
  const lines = await db().select().from(orderLines).where(and(eq(orderLines.orderId, order.id), eq(orderLines.store, so.store)));
  try {
    const w = await createWooOrder({
      storeKey: so.store, user: dealer, address: order.shippingAddress, portalOrderId: order.id, portalOrderNumber: order.number,
      poNumber: order.poNumber, paid: order.status === "processing", paymentSummary: "See dealer portal",
      discountCode: order.discountCode ?? undefined,
      // Each line's share of any discount code, so the brand's order matches what was charged.
      lines: lines.map((l) => ({ productId: l.productId, variationId: l.variationId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount })),
    });
    await db().update(storeOrders).set({ wooOrderId: w.id, wooStatus: w.status, error: null, updatedAt: new Date() }).where(eq(storeOrders.id, so.id));
  } catch (err) {
    await db().update(storeOrders).set({ error: err instanceof Error ? err.message : String(err) }).where(eq(storeOrders.id, so.id));
  }
  await audit(admin, "order.retry_store", `order:${order.id}`, { store: so.store });
  revalidatePath(`/admin/orders/${order.id}`);
}

export type SyncResult = { ok: boolean; message: string; seconds: number } | undefined;

/** Full sync of one store. Returns a summary for the button's status line. */
export async function runSync(_: SyncResult, form: FormData): Promise<SyncResult> {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return { ok: false, message: "Only super admins can run a sync.", seconds: 0 };
  const store = String(form.get("store"));
  if (!isStoreKey(store)) return { ok: false, message: "Unknown store.", seconds: 0 };
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  await audit(admin, "store.full_sync", `store:${store}`);
  try {
    const { products, rows } = await syncStore(store, { full: true });
    revalidatePath("/admin/sync");
    return { ok: true, message: `Synced ${products} products (${rows} items incl. variations).`, seconds: seconds() };
  } catch (err) {
    // The error is also recorded in sync_state and shown on the card.
    revalidatePath("/admin/sync");
    return { ok: false, message: `Sync failed: ${errorMessage(err)}`, seconds: seconds() };
  }
}

/** Re-send a failed email from the email log. Super admins only (the log covers every brand). */
export async function retryEmail(form: FormData) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return;
  const id = Number(form.get("id"));
  if (Number.isSafeInteger(id)) {
    await resendLoggedEmail(id);
    await audit(admin, "email.retry", `email:${id}`);
  }
  revalidatePath("/admin/emails");
}
