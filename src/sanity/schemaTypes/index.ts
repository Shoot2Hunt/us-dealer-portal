import { defineArrayMember, defineField, defineType } from "sanity";
import { contactSubmission, footerSettings, headerSettings, pluginSettings, securitySettings, themeSettings } from "./site";
import { discountCode, promotion } from "./promotions";
import { DealerPriceInput, SkuInput } from "../components/product-pricing";

/** US state codes used for shipping restrictions. */
const STATE_OPTIONS = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
  .split(" ")
  .map((s) => ({ title: s, value: s }));

export const siteSettings = defineType({
  name: "siteSettings",
  title: "Portal settings",
  type: "document",
  fields: [
    defineField({ name: "portalName", type: "string", initialValue: "Dealer Portal", validation: (r) => r.required() }),
    defineField({ name: "logo", type: "image" }),
    defineField({ name: "loginMessage", title: "Message on the sign-in page", type: "text", rows: 3 }),
    defineField({ name: "requestAccessIntro", title: "Intro on the request-access page", type: "text", rows: 3 }),
    defineField({ name: "welcomeMessage", title: "Welcome message for signed-in dealers", type: "text", rows: 3 }),
    defineField({ name: "supportEmail", type: "string" }),
    defineField({ name: "supportPhone", type: "string" }),
  ],
  preview: { prepare: () => ({ title: "Portal settings" }) },
});

export const paymentSettings = defineType({
  name: "paymentSettings",
  title: "Payment settings",
  type: "document",
  fields: [
    defineField({ name: "enableCard", title: "Accept credit cards", type: "boolean", initialValue: true }),
    defineField({ name: "enableAch", title: "Accept ACH (eCheck)", type: "boolean", initialValue: true }),
    defineField({ name: "enableCheck", title: "Accept mailed checks", type: "boolean", initialValue: true }),
    defineField({ name: "allowSplit", title: "Allow split payments", type: "boolean", initialValue: true }),
    defineField({
      name: "maxSplitParts",
      title: "Most payment methods in one split",
      type: "number",
      initialValue: 3,
      validation: (r) => r.min(2).max(5),
    }),
    defineField({ name: "checkPayableTo", title: "Make checks payable to", type: "string" }),
    defineField({ name: "checkMailingAddress", title: "Mail checks to", type: "text", rows: 4 }),
    defineField({ name: "checkoutNote", title: "Note shown at checkout", type: "text", rows: 3 }),
  ],
  preview: { prepare: () => ({ title: "Payment settings" }) },
});

export const brand = defineType({
  name: "brand",
  title: "Brand",
  type: "document",
  fields: [
    defineField({ name: "name", type: "string", validation: (r) => r.required() }),
    defineField({
      name: "storeKey",
      title: "Store key",
      description: "Must match the store in the portal config: unknown-suppressors, unknown-munitions, salmon-river-solutions or shoot2hunt.",
      type: "string",
      options: {
        list: [
          { title: "Unknown Suppressors", value: "unknown-suppressors" },
          { title: "Unknown Munitions", value: "unknown-munitions" },
          { title: "Salmon River Solutions", value: "salmon-river-solutions" },
          { title: "Shoot2Hunt", value: "shoot2hunt" },
        ],
      },
      validation: (r) => r.required(),
    }),
    defineField({ name: "active", title: "Show in portal", type: "boolean", initialValue: true }),
    defineField({ name: "logo", type: "image" }),
    defineField({
      name: "footerLogo",
      title: "Logo for dark backgrounds",
      description: "A light/white version shown in the dark footer. Falls back to the built-in file, then to Logo.",
      type: "image",
    }),
    defineField({
      name: "color",
      title: "Brand color",
      description: "Hex color like #e4232a. Used for this brand's tag on product pages and in the inventory.",
      type: "string",
      validation: (r) => r.regex(/^#[0-9a-fA-F]{6}$/).error("Use a 6-digit hex color, e.g. #e4232a"),
    }),
    defineField({
      name: "website",
      title: "Website",
      description: "Linked from the portal footer. Leave blank to use the store's WooCommerce URL.",
      type: "url",
    }),
    defineField({ name: "description", type: "text", rows: 3 }),
    defineField({ name: "sortOrder", type: "number", initialValue: 0 }),
    defineField({
      name: "notificationEmails",
      title: "Emails notified of access requests and orders",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
    }),
    defineField({
      name: "dealerDiscountPercent",
      title: "Default dealer discount (%) off retail",
      description: "Used when a product has no dealer price of its own.",
      type: "number",
      initialValue: 0,
      validation: (r) => r.min(0).max(100),
    }),
    defineField({
      name: "sotRequiredCategories",
      title: "WooCommerce category slugs that need a verified SOT",
      description: "For example: suppressors. Dealers without a current SOT can't order these.",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
    }),
    defineField({
      name: "shippingRestrictions",
      title: "Shipping restrictions",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "restriction",
          fields: [
            defineField({ name: "categorySlug", title: "Category slug (blank = every product)", type: "string" }),
            defineField({
              name: "states",
              title: "Can't ship to",
              type: "array",
              of: [defineArrayMember({ type: "string" })],
              options: { list: STATE_OPTIONS },
            }),
            defineField({ name: "message", title: "Message shown to the dealer", type: "string" }),
          ],
          preview: {
            select: { c: "categorySlug", s: "states" },
            prepare: ({ c, s }) => ({ title: `${c || "All products"} → ${(s ?? []).join(", ")}` }),
          },
        }),
      ],
    }),
  ],
  orderings: [{ title: "Sort order", name: "sort", by: [{ field: "sortOrder", direction: "asc" }] }],
});

export const productOverride = defineType({
  name: "productOverride",
  title: "Product setting",
  type: "document",
  description: "Dealer-only settings for one WooCommerce product, matched by SKU.",
  fields: [
    defineField({ name: "brand", type: "reference", to: [{ type: "brand" }], validation: (r) => r.required() }),
    defineField({
      name: "sku",
      title: "SKU",
      description: "Search below to fill this in from the synced catalog.",
      type: "string",
      validation: (r) => r.required(),
      components: { input: SkuInput },
    }),
    defineField({ name: "label", title: "Label (for your reference)", type: "string" }),
    defineField({ name: "hidden", title: "Hide from dealers", type: "boolean", initialValue: false }),
    defineField({
      name: "dealerPrice",
      title: "Dealer price ($)",
      description: "Replaces the regular dealer price. Lower than regular = shown to dealers as a sale, with the old price crossed out.",
      type: "number",
      validation: (r) => r.min(0).precision(2),
      components: { input: DealerPriceInput },
    }),
    defineField({
      name: "saleStarts",
      title: "Price starts",
      description: "Optional. Leave both dates blank for a permanent price.",
      type: "datetime",
    }),
    defineField({
      name: "saleEnds",
      title: "Price ends",
      description: "Optional. After this, dealers pay the regular price again.",
      type: "datetime",
      validation: (r) =>
        r.custom((end, ctx) => {
          const start = (ctx.parent as { saleStarts?: string } | undefined)?.saleStarts;
          return !end || !start || new Date(end) > new Date(start) ? true : "Must be after the start";
        }),
    }),
    defineField({ name: "minQuantity", title: "Minimum order quantity", type: "number", validation: (r) => r.min(1) }),
    defineField({ name: "featured", type: "boolean", initialValue: false }),
    defineField({ name: "dealerNote", title: "Note shown to dealers", type: "string" }),
  ],
  preview: {
    select: { sku: "sku", label: "label", brand: "brand.name", hidden: "hidden", price: "dealerPrice", ends: "saleEnds" },
    prepare: ({ sku, label, brand, hidden, price, ends }) => ({
      title: `${label || sku}${hidden ? " (hidden)" : ""}`,
      subtitle: [brand, sku, typeof price === "number" ? "$" + price.toFixed(2) : null, ends ? `until ${new Date(ends).toLocaleDateString()}` : null].filter(Boolean).join(" · "),
    }),
  },
});

export const announcement = defineType({
  name: "announcement",
  title: "Announcement",
  type: "document",
  fields: [
    defineField({ name: "title", type: "string", validation: (r) => r.required() }),
    defineField({ name: "body", type: "text", rows: 3 }),
    defineField({ name: "active", type: "boolean", initialValue: true }),
    defineField({ name: "startsAt", type: "datetime" }),
    defineField({ name: "endsAt", type: "datetime" }),
  ],
});

export const page = defineType({
  name: "page",
  title: "Page",
  type: "document",
  description:
    "Terms, FAQ, shipping policy and other pages dealers can read at /p/<slug>. The footer's policy links use the slugs terms-and-conditions, privacy-policy and return-policy; those three are also public at /legal/<slug>.",
  fields: [
    defineField({ name: "title", type: "string", validation: (r) => r.required() }),
    defineField({ name: "slug", type: "slug", options: { source: "title" }, validation: (r) => r.required() }),
    defineField({ name: "showInNav", title: "Link in the portal menu", type: "boolean", initialValue: false }),
    defineField({ name: "showInFooter", title: "Link in the footer", type: "boolean", initialValue: false }),
    defineField({ name: "description", title: "Search/preview description", type: "string", validation: (r) => r.max(160) }),
    defineField({ name: "body", type: "array", of: [defineArrayMember({ type: "block" })] }),
  ],
});

export const schemaTypes = [
  siteSettings,
  paymentSettings,
  themeSettings,
  headerSettings,
  footerSettings,
  securitySettings,
  pluginSettings,
  brand,
  productOverride,
  promotion,
  discountCode,
  announcement,
  page,
  contactSubmission,
];
/** One document each, opened directly from the Studio menu. */
export const SINGLETONS = ["siteSettings", "paymentSettings", "themeSettings", "headerSettings", "footerSettings", "securitySettings", "pluginSettings"];
/** Created by the portal, never from Studio's "Create" menu. */
export const PORTAL_CREATED = ["contactSubmission"];
