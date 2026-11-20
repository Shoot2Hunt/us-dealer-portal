"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
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

function canManageBrand(admin: User, brandSlug: string) {
  return admin.role === "super_admin" || admin.brandSlug === brandSlug;
}

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
  const [req] = await db().select().from(accessRequests).where(eq(accessRequests.id, id));
  if (!req || req.status !== "pending" || !canManageBrand(admin, req.brandSlug)) return;

  const sotVerified = form.get("sotVerified") === "on";
  const sotExpires = String(form.get("sotExpires") ?? "") || null;
  const [existing] = await db().select().from(users).where(eq(users.email, req.email));
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
  revalidatePath("/admin");
}

export async function denyRequest(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("id"));
  const [req] = await db().select().from(accessRequests).where(eq(accessRequests.id, id));
  if (!req || !canManageBrand(admin, req.brandSlug)) return;
  await db().update(accessRequests).set({ status: "denied", handledBy: admin.id, handledAt: new Date() }).where(eq(accessRequests.id, id));
  if (form.get("notify") === "on") {
    await sendEmail({ to: req.email, kind: "access_request.denied", ...(await accessDenied({ name: req.name, brandName: storeName(req.brandSlug) })) });
  }
  revalidatePath("/admin");
}

export async function updateDealer(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id"));
  const brands = form.getAll("allowedBrands").map(String).filter(isStoreKey);
  await db()
    .update(users)
    .set({
      status: form.get("status") === "suspended" ? "suspended" : "active",
      fflExpires: String(form.get("fflExpires") ?? "") || null,
      sotVerified: form.get("sotVerified") === "on",
      sotExpires: String(form.get("sotExpires") ?? "") || null,
      allowedBrands: brands.length ? brands : null,
    })
    .where(and(eq(users.id, id), eq(users.role, "dealer")));
  revalidatePath("/admin/dealers");
}

export async function resendSetupLink(form: FormData) {
  await requireAdmin();
  const [user] = await db().select().from(users).where(eq(users.id, String(form.get("id"))));
  if (user) await sendSetupLink(user, "onboarding.setup_link", (setPasswordUrl) => setupLinkResent({ name: user.name, setPasswordUrl }));
}

/**
 * For someone who lost their phone and their recovery codes. Super admins only: turns off
 * two-step verification, signs the user out everywhere, and emails them about it.
 */
export async function resetTwoFactor(form: FormData) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return;
  const id = String(form.get("id"));
  if (id === admin.id) return; // use your own account page for yourself
  const [user] = await db().select().from(users).where(eq(users.id, id));
  if (!user?.totpEnabledAt) return;
  await signOutOtherSessions(user.id, CLEARED_TWO_FACTOR);
  await sendEmail({ to: user.email, kind: "2fa.disabled", ...(await twoFactorDisabled({ name: user.name, byAdmin: true })) });
  revalidatePath("/admin/dealers");
}

export async function createAdmin(form: FormData) {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return;
  const role = form.get("role") === "super_admin" ? "super_admin" : "brand_admin";
  const brandSlug = String(form.get("brandSlug") ?? "");
  const [user] = await db()
    .insert(users)
    .values({
      email: String(form.get("email")).trim().toLowerCase(),
      name: String(form.get("name")).trim(),
      role,
      brandSlug: role === "brand_admin" && isStoreKey(brandSlug) ? brandSlug : null,
      approvedBy: admin.id,
    })
    .onConflictDoNothing()
    .returning();
  if (user) await sendSetupLink(user, "onboarding.admin_invite", (setPasswordUrl) => adminInvite({ name: user.name, setPasswordUrl }));
  revalidatePath("/admin/dealers");
}

export async function markCheckReceived(form: FormData) {
  await requireAdmin();
  const paymentId = Number(form.get("paymentId"));
  const [p] = await db()
    .update(payments)
    .set({ status: "received", updatedAt: new Date() })
    .where(and(eq(payments.id, paymentId), eq(payments.method, "check"), eq(payments.status, "awaiting_check")))
    .returning();
  if (p) await releaseIfPaid(p.orderId);
  revalidatePath(`/admin/orders/${p?.orderId}`);
}

/** Retry sending one brand's part of an order to WooCommerce (after a failure at checkout). */
export async function retryStoreOrder(form: FormData) {
  await requireAdmin();
  const [so] = await db().select().from(storeOrders).where(eq(storeOrders.id, Number(form.get("storeOrderId"))));
  if (!so || so.wooOrderId || !isStoreKey(so.store)) return;
  const [order] = await db().select().from(orders).where(eq(orders.id, so.orderId));
  const [dealer] = await db().select().from(users).where(eq(users.id, order.userId));
  const lines = await db().select().from(orderLines).where(and(eq(orderLines.orderId, order.id), eq(orderLines.store, so.store)));
  try {
    const w = await createWooOrder({
      storeKey: so.store, user: dealer, address: order.shippingAddress, portalOrderId: order.id, portalOrderNumber: order.number,
      poNumber: order.poNumber, paid: order.status === "processing", paymentSummary: "See dealer portal",
      lines: lines.map((l) => ({ productId: l.productId, variationId: l.variationId, quantity: l.quantity, unitPrice: l.unitPrice })),
    });
    await db().update(storeOrders).set({ wooOrderId: w.id, wooStatus: w.status, error: null, updatedAt: new Date() }).where(eq(storeOrders.id, so.id));
  } catch (err) {
    await db().update(storeOrders).set({ error: err instanceof Error ? err.message : String(err) }).where(eq(storeOrders.id, so.id));
  }
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
  if (Number.isInteger(id)) await resendLoggedEmail(id);
  revalidatePath("/admin/emails");
}
