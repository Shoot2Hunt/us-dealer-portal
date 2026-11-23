import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  index,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["dealer", "brand_admin", "super_admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);
export const requestStatusEnum = pgEnum("request_status", ["pending", "approved", "denied"]);
export const orderStatusEnum = pgEnum("order_status", [
  "processing", // fully paid, sent to the brands
  "awaiting_payment", // check or eCheck not yet cleared; Woo orders On hold
  "payment_problem", // eCheck returned, etc.
  "failed",
  "cancelled",
]);
export const paymentMethodEnum = pgEnum("payment_method", ["card", "ach", "check"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "authorized", // card, not yet captured
  "captured", // card, done
  "pending_settlement", // eCheck submitted, waiting to settle
  "settled", // eCheck settled
  "awaiting_check",
  "received", // check received
  "declined",
  "voided",
  "returned", // eCheck returned
]);

export type Address = {
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postcode: string;
  phone?: string;
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  company: text("company"),
  phone: text("phone"),
  passwordHash: text("password_hash"),
  role: roleEnum("role").notNull().default("dealer"),
  /** For brand admins: the brand they manage. */
  brandSlug: text("brand_slug"),
  status: userStatusEnum("status").notNull().default("active"),
  fflNumber: text("ffl_number"),
  fflExpires: date("ffl_expires"),
  sotVerified: boolean("sot_verified").notNull().default(false),
  sotExpires: date("sot_expires"),
  /** Null means the dealer can see and order from every brand. */
  allowedBrands: text("allowed_brands").array(),
  shippingAddress: jsonb("shipping_address").$type<Address>(),
  setupTokenHash: text("setup_token_hash"),
  setupTokenExpires: timestamp("setup_token_expires", { withTimezone: true }),
  /** Last "forgot password" email, to stop repeated requests from flooding the inbox. */
  passwordResetRequestedAt: timestamp("password_reset_requested_at", { withTimezone: true }),
  /** Bumped to sign the user out everywhere (password change, "sign out other devices"). */
  sessionVersion: integer("session_version").notNull().default(0),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  // --- Two-step verification (authenticator app, TOTP). Secrets are encrypted (src/lib/auth/totp.ts). ---
  totpSecret: text("totp_secret"),
  /** Secret shown during setup, until the user confirms it with a code. */
  totpPendingSecret: text("totp_pending_secret"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  /** Last accepted 30-second step, so a code can't be used twice. */
  totpLastStep: integer("totp_last_step"),
  totpFailedAttempts: integer("totp_failed_attempts").notNull().default(0),
  totpLockedUntil: timestamp("totp_locked_until", { withTimezone: true }),
  /** SHA-256 hashes of unused one-time recovery codes. */
  recoveryCodeHashes: text("recovery_code_hashes").array(),
  approvedBy: uuid("approved_by"),
  /*
   * Saved-card / Authorize.net columns that already exist in the database but were added
   * outside this codebase. Declared here so `db:push` keeps them (it drops anything the
   * schema doesn't list). Nothing in this app reads or writes them yet.
   */
  billingAddress: jsonb("billing_address"),
  authnetCustomerProfileId: text("authnet_customer_profile_id"),
  cardAddAttempts: integer("card_add_attempts").notNull().default(0),
  cardAddWindowStart: timestamp("card_add_window_start", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accessRequests = pgTable("access_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull(),
  phone: text("phone"),
  brandSlug: text("brand_slug").notNull(),
  fflNumber: text("ffl_number").notNull(),
  fflExpires: date("ffl_expires"),
  hasSot: boolean("has_sot").notNull().default(false),
  message: text("message"),
  status: requestStatusEnum("status").notNull().default("pending"),
  handledBy: uuid("handled_by"),
  handledAt: timestamp("handled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const licenseDocKindEnum = pgEnum("license_doc_kind", ["ffl", "sot"]);

/**
 * FFL / SOT copies uploaded with an access request. Linked to the dealer's user
 * once the request is approved. Only admins and that dealer may view them
 * (enforced in /api/license-documents/[id]).
 */
export const licenseDocuments = pgTable("license_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  accessRequestId: uuid("access_request_id"),
  userId: uuid("user_id"),
  kind: licenseDocKindEnum("kind").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  /** File bytes, base64-encoded. Never select this in list queries. */
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailStatusEnum = pgEnum("email_status", [
  "sent", // accepted by the email provider
  "failed", // gave up after retries; shown on /admin/emails
  "logged", // no provider configured (development); printed to the console only
]);

/** Every email the portal tries to send, so failures are visible and can be retried. */
export const emailLog = pgTable("email_log", {
  id: serial("id").primaryKey(),
  /** What kind of email this is, e.g. "access_request.admin" or "password.reset". */
  kind: text("kind").notNull(),
  to: text("to").array().notNull(),
  subject: text("subject").notNull(),
  status: emailStatusEnum("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  providerId: text("provider_id"),
  error: text("error"),
  /**
   * Stored so a failed email can be re-sent as-is. Null for emails that contain
   * a password link: those are re-sent by issuing a fresh link instead.
   */
  body: jsonb("body").$type<{ text: string; html?: string; replyTo?: string }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventory = pgTable(
  "inventory",
  {
    id: serial("id").primaryKey(),
    store: text("store").notNull(),
    productId: integer("product_id").notNull(),
    /** 0 for simple products. */
    variationId: integer("variation_id").notNull().default(0),
    parentName: text("parent_name"),
    name: text("name").notNull(),
    sku: text("sku"),
    categories: text("categories").array().notNull().default([]),
    manageStock: boolean("manage_stock").notNull().default(false),
    stockQuantity: integer("stock_quantity"),
    stockStatus: text("stock_status").notNull().default("instock"),
    retailPrice: numeric("retail_price", { precision: 12, scale: 2 }),
    imageUrl: text("image_url"),
    permalink: text("permalink"),
    /** Product detail page. Raw HTML from WooCommerce; sanitized when rendered. */
    description: text("description"),
    shortDescription: text("short_description"),
    /** Every product image, main image first. */
    images: text("images").array().notNull().default([]),
    /** This variation's options, e.g. [{ name: "Caliber", option: "9mm" }]. Empty for simple products. */
    attributes: jsonb("attributes").$type<ProductAttribute[]>().notNull().default([]),
    /** Visible, non-variation product attributes shown as specifications. */
    specs: jsonb("specs").$type<ProductSpec[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inventory_store_product_variation").on(t.store, t.productId, t.variationId)],
);

export const syncState = pgTable("sync_state", {
  store: text("store").primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
  lastError: text("last_error"),
});

/** Links a portal dealer to their customer record in each WooCommerce store. */
export const storeCustomers = pgTable(
  "store_customers",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    store: text("store").notNull(),
    wooCustomerId: integer("woo_customer_id").notNull(),
  },
  (t) => [uniqueIndex("store_customers_user_store").on(t.userId, t.store)],
);

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: serial("number").notNull(),
  userId: uuid("user_id").notNull(),
  status: orderStatusEnum("status").notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  shippingAddress: jsonb("shipping_address").$type<Address>().notNull(),
  poNumber: text("po_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderLines = pgTable("order_lines", {
  id: serial("id").primaryKey(),
  orderId: uuid("order_id").notNull(),
  store: text("store").notNull(),
  productId: integer("product_id").notNull(),
  variationId: integer("variation_id").notNull().default(0),
  sku: text("sku"),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
});

/** One WooCommerce order per brand per portal order. */
export const storeOrders = pgTable("store_orders", {
  id: serial("id").primaryKey(),
  orderId: uuid("order_id").notNull(),
  store: text("store").notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  wooOrderId: integer("woo_order_id"),
  wooStatus: text("woo_status"),
  tracking: text("tracking"),
  error: text("error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  orderId: uuid("order_id").notNull(),
  method: paymentMethodEnum("method").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: paymentStatusEnum("status").notNull(),
  transId: text("trans_id"),
  last4: text("last4"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type InventoryRow = typeof inventory.$inferSelect;
export type ProductAttribute = { name: string; option: string };
export type ProductSpec = { name: string; value: string };
export type EmailLogRow = typeof emailLog.$inferSelect;
export type LicenseDocKind =(typeof licenseDocKindEnum.enumValues)[number];
export type Order = typeof orders.$inferSelect;
export type Payment = typeof payments.$inferSelect;

/**
 * One row per page view, recorded by /api/track. No cookies: `visitor` is a salted hash of
 * IP + browser that changes every day, so a person can't be followed across days.
 */
export const pageViews = pgTable(
  "page_views",
  {
    id: serial("id").primaryKey(),
    path: text("path").notNull(),
    /** Host of an outside site that sent the visitor, e.g. "google.com". */
    referrerHost: text("referrer_host"),
    visitor: text("visitor").notNull(),
    userId: uuid("user_id"),
    role: text("role"),
    /** Two-letter country code from the hosting provider, when available. */
    country: text("country"),
    device: text("device").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("page_views_created_at").on(t.createdAt)],
);

/** Failed sign-ins per email address, for the lockout set in Sanity → Security. */
export const loginThrottle = pgTable("login_throttle", {
  /** Lower-cased email. Tracked whether or not an account exists, so lockouts reveal nothing. */
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  firstFailureAt: timestamp("first_failure_at", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
