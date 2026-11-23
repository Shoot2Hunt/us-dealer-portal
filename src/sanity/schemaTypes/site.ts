import { defineArrayMember, defineField, defineType } from "sanity";
import { BODY_FONTS, CORNER_STYLES, HEADING_FONTS, THEME_PRESETS } from "../../lib/theme";
import { CONTACT_TOPICS } from "../../lib/contact";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** A custom-theme color, only shown when "Custom colors…" is picked. */
const customColor = (name: string, title: string, description: string) =>
  defineField({
    name,
    title,
    description: `${description} A hex color like #b4532a.`,
    type: "string",
    hidden: ({ parent }) => (parent as { preset?: string } | undefined)?.preset !== "custom",
    validation: (r) => r.regex(HEX_COLOR, { name: "hex color" }).error("Use a 6-digit hex color, e.g. #b4532a"),
  });

/** Icons admins can put next to header links. Keys map to Iconify classes in the portal. */
export const NAV_ICONS = [
  { title: "None", value: "" },
  { title: "Boxes (inventory)", value: "boxes" },
  { title: "Receipt (orders)", value: "receipt" },
  { title: "Document", value: "file" },
  { title: "Question", value: "help" },
  { title: "Phone", value: "phone" },
  { title: "Truck (shipping)", value: "truck" },
  { title: "Tag (deals)", value: "tag" },
  { title: "Star", value: "star" },
  { title: "Info", value: "info" },
  { title: "Percent (promotions)", value: "percent" },
];

const linkFields = [
  defineField({ name: "label", type: "string", validation: (r) => r.required().max(40) }),
  defineField({
    name: "href",
    title: "Link",
    description: "A portal path like /inventory or /p/shipping, or a full https:// address.",
    type: "string",
    validation: (r) =>
      r.required().custom((v) => (!v || v.startsWith("/") || /^https?:\/\//.test(v) || v.startsWith("mailto:") || v.startsWith("tel:") ? true : "Start with /, https://, mailto: or tel:")),
  }),
];

// ---------------------------------------------------------------- Appearance

export const themeSettings = defineType({
  name: "themeSettings",
  title: "Theme",
  type: "document",
  fields: [
    defineField({
      name: "preset",
      title: "Color theme",
      type: "string",
      initialValue: "rust",
      options: {
        list: [...Object.entries(THEME_PRESETS).map(([value, p]) => ({ title: p.title, value })), { title: "Custom colors…", value: "custom" }],
        layout: "radio",
      },
    }),
    customColor("customAccent", "Accent color", "Buttons, links and highlights."),
    customColor("customInk", "Dark color", "Header, footer and text. Keep it dark so white text stays readable."),
    customColor("customGold", "Highlight color", "Used sparingly, e.g. the Admin link."),
    defineField({
      name: "headingFont",
      title: "Heading font",
      type: "string",
      initialValue: "montserrat",
      options: { list: Object.entries(HEADING_FONTS).map(([value, title]) => ({ title, value })) },
    }),
    defineField({
      name: "bodyFont",
      title: "Body font",
      type: "string",
      initialValue: "roboto",
      options: { list: Object.entries(BODY_FONTS).map(([value, title]) => ({ title, value })) },
    }),
    defineField({
      name: "corners",
      title: "Corners",
      type: "string",
      initialValue: "rounded",
      options: { list: Object.entries(CORNER_STYLES).map(([value, c]) => ({ title: c.title, value })), layout: "radio", direction: "horizontal" },
    }),
  ],
  preview: { prepare: () => ({ title: "Theme" }) },
});

export const headerSettings = defineType({
  name: "headerSettings",
  title: "Header",
  type: "document",
  fields: [
    defineField({ name: "showLogo", title: "Show logo", type: "boolean", initialValue: true }),
    defineField({ name: "sticky", title: "Keep header visible while scrolling", type: "boolean", initialValue: true }),
    defineField({
      name: "links",
      title: "Menu links",
      description: "Leave empty for the default: Inventory and Orders.",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "navLink",
          fields: [...linkFields, defineField({ name: "icon", type: "string", options: { list: NAV_ICONS } })],
          preview: { select: { title: "label", subtitle: "href" } },
        }),
      ],
      validation: (r) => r.max(8),
    }),
    defineField({ name: "showPages", title: "Also show Pages marked \"Link in the portal menu\"", type: "boolean", initialValue: true }),
    defineField({ name: "showContact", title: "Show a Contact link", type: "boolean", initialValue: false }),
  ],
  preview: { prepare: () => ({ title: "Header" }) },
});

export const footerSettings = defineType({
  name: "footerSettings",
  title: "Footer",
  type: "document",
  fields: [
    defineField({ name: "tagline", type: "text", rows: 2, initialValue: "Wholesale ordering for authorized dealers, across all of our brands in one place." }),
    defineField({ name: "showBrands", title: "Show brand logos", type: "boolean", initialValue: true }),
    defineField({ name: "brandsHeading", title: "Brand logos heading", type: "string", initialValue: "Our brands" }),
    defineField({
      name: "columns",
      title: "Link columns",
      type: "array",
      validation: (r) => r.max(3),
      of: [
        defineArrayMember({
          type: "object",
          name: "column",
          fields: [
            defineField({ name: "title", type: "string", validation: (r) => r.required() }),
            defineField({
              name: "links",
              type: "array",
              of: [defineArrayMember({ type: "object", name: "footerLink", fields: linkFields, preview: { select: { title: "label", subtitle: "href" } } })],
            }),
          ],
        }),
      ],
    }),
    defineField({ name: "showPolicies", title: "Show the policy links (Terms, Privacy, Returns)", type: "boolean", initialValue: true }),
    defineField({ name: "showContact", title: "Show a Contact us link", type: "boolean", initialValue: true }),
    defineField({
      name: "social",
      title: "Social links",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "socialLink",
          fields: [
            defineField({
              name: "platform",
              type: "string",
              validation: (r) => r.required(),
              options: { list: ["facebook", "instagram", "youtube", "twitter", "linkedin", "website"].map((v) => ({ title: v === "twitter" ? "X / Twitter" : v[0]!.toUpperCase() + v.slice(1), value: v })) },
            }),
            defineField({ name: "url", type: "url", validation: (r) => r.required().uri({ scheme: ["https"] }) }),
          ],
          preview: { select: { title: "platform", subtitle: "url" } },
        }),
      ],
    }),
    defineField({ name: "copyright", description: "Use {year} for the current year. Leave blank for \"© {year} <portal name>. All rights reserved.\"", type: "string" }),
  ],
  preview: { prepare: () => ({ title: "Footer" }) },
});

// ---------------------------------------------------------------- Security

export const securitySettings = defineType({
  name: "securitySettings",
  title: "Security",
  type: "document",
  description: "Limits are enforced in the portal too, so values outside the allowed range are clamped.",
  fieldsets: [
    { name: "twoFactor", title: "Two-step verification" },
    { name: "sessions", title: "Sign-in" },
    { name: "passwords", title: "Passwords" },
  ],
  fields: [
    defineField({
      name: "requireTwoFactorAdmins",
      title: "Require for admins",
      description: "Admins without it are sent to set it up before they can use the admin area.",
      type: "boolean",
      initialValue: false,
      fieldset: "twoFactor",
    }),
    defineField({ name: "requireTwoFactorDealers", title: "Require for dealers", type: "boolean", initialValue: false, fieldset: "twoFactor" }),
    defineField({
      name: "sessionDays",
      title: "Stay signed in for (days)",
      description: "1–30. Applies to new sign-ins.",
      type: "number",
      initialValue: 7,
      validation: (r) => r.required().integer().min(1).max(30),
      fieldset: "sessions",
    }),
    defineField({
      name: "maxLoginAttempts",
      title: "Wrong passwords before lockout",
      description: "3–10, per email address.",
      type: "number",
      initialValue: 5,
      validation: (r) => r.required().integer().min(3).max(10),
      fieldset: "sessions",
    }),
    defineField({
      name: "lockoutMinutes",
      title: "Lockout length (minutes)",
      description: "5–1440.",
      type: "number",
      initialValue: 15,
      validation: (r) => r.required().integer().min(5).max(1440),
      fieldset: "sessions",
    }),
    defineField({
      name: "passwordMinLength",
      title: "Minimum password length",
      description: "10–64.",
      type: "number",
      initialValue: 10,
      validation: (r) => r.required().integer().min(10).max(64),
      fieldset: "passwords",
    }),
    defineField({ name: "blockCommonPasswords", title: "Block common passwords", type: "boolean", initialValue: true, fieldset: "passwords" }),
  ],
  preview: { prepare: () => ({ title: "Security" }) },
});

// ---------------------------------------------------------------- Plugins

const enabledToggle = defineField({ name: "enabled", title: "Turned on", type: "boolean", initialValue: false });
const hiddenUnlessOn = ({ parent }: { parent?: unknown }) => !(parent as { enabled?: boolean } | undefined)?.enabled;

export const pluginSettings = defineType({
  name: "pluginSettings",
  title: "Plugins",
  type: "document",
  fields: [
    defineField({
      name: "analytics",
      title: "Analytics & tracking",
      description: "Third-party tracking. Portal visit statistics are recorded separately and need no setup.",
      type: "object",
      options: { collapsible: true, collapsed: false },
      fields: [
        enabledToggle,
        defineField({ name: "ga4Id", title: "Google Analytics 4 measurement ID", description: "Looks like G-ABC123XYZ.", type: "string", hidden: hiddenUnlessOn, validation: (r) => r.regex(/^G-[A-Z0-9]{4,15}$/).error("Should look like G-ABC123XYZ") }),
        defineField({ name: "gtmId", title: "Google Tag Manager container ID", description: "Looks like GTM-ABC1234.", type: "string", hidden: hiddenUnlessOn, validation: (r) => r.regex(/^GTM-[A-Z0-9]{4,12}$/).error("Should look like GTM-ABC1234") }),
        defineField({ name: "metaPixelId", title: "Meta (Facebook) Pixel ID", description: "Numbers only.", type: "string", hidden: hiddenUnlessOn, validation: (r) => r.regex(/^\d{8,20}$/).error("Numbers only") }),
      ],
    }),
    defineField({
      name: "cookieConsent",
      title: "Cookie consent banner",
      description: "When on, analytics & tracking only load after the visitor accepts.",
      type: "object",
      options: { collapsible: true, collapsed: false },
      fields: [
        enabledToggle,
        defineField({ name: "message", type: "text", rows: 2, hidden: hiddenUnlessOn, initialValue: "We use cookies to understand how the portal is used and to improve it." }),
        defineField({ name: "acceptLabel", title: "Accept button", type: "string", hidden: hiddenUnlessOn, initialValue: "Accept" }),
        defineField({ name: "declineLabel", title: "Decline button", type: "string", hidden: hiddenUnlessOn, initialValue: "Decline" }),
        defineField({ name: "showPrivacyLink", title: "Link to the Privacy Policy", type: "boolean", hidden: hiddenUnlessOn, initialValue: true }),
      ],
    }),
    defineField({
      name: "maintenance",
      title: "Maintenance mode",
      description: "Dealers see this message instead of the portal. Admins can still sign in and use everything.",
      type: "object",
      options: { collapsible: true, collapsed: false },
      fields: [
        enabledToggle,
        defineField({ name: "title", type: "string", hidden: hiddenUnlessOn, initialValue: "We'll be right back" }),
        defineField({ name: "message", type: "text", rows: 3, hidden: hiddenUnlessOn, initialValue: "The dealer portal is down for scheduled maintenance. Please check back soon." }),
        defineField({ name: "until", title: "Expected back (optional)", type: "datetime", hidden: hiddenUnlessOn }),
      ],
    }),
  ],
  preview: { prepare: () => ({ title: "Plugins" }) },
});

// ---------------------------------------------------------------- Inbox

export const contactSubmission = defineType({
  name: "contactSubmission",
  title: "Contact message",
  type: "document",
  fields: [
    defineField({
      name: "status",
      type: "string",
      initialValue: "new",
      options: { list: [{ title: "New", value: "new" }, { title: "In progress", value: "in_progress" }, { title: "Resolved", value: "resolved" }], layout: "radio", direction: "horizontal" },
    }),
    defineField({ name: "internalNotes", title: "Internal notes", description: "Only visible here in Studio.", type: "text", rows: 3 }),
    defineField({ name: "submittedAt", title: "Received", type: "datetime", readOnly: true }),
    defineField({ name: "name", type: "string", readOnly: true }),
    defineField({ name: "email", type: "string", readOnly: true }),
    defineField({ name: "company", type: "string", readOnly: true }),
    defineField({ name: "phone", type: "string", readOnly: true }),
    defineField({ name: "topic", type: "string", readOnly: true, options: { list: [...CONTACT_TOPICS] } }),
    defineField({ name: "message", type: "text", rows: 8, readOnly: true }),
    defineField({ name: "isDealer", title: "Sent by a signed-in dealer", type: "boolean", readOnly: true }),
    defineField({ name: "page", title: "Sent from", type: "string", readOnly: true }),
    // Hashed IP for rate limiting only. Never shown.
    defineField({ name: "ipHash", type: "string", readOnly: true, hidden: true }),
  ],
  orderings: [{ title: "Newest first", name: "newest", by: [{ field: "submittedAt", direction: "desc" }] }],
  preview: {
    select: { name: "name", email: "email", topic: "topic", status: "status", at: "submittedAt" },
    prepare: ({ name, email, topic, status, at }) => ({
      title: `${status === "new" ? "● " : ""}${name ?? email ?? "Unknown"}`,
      subtitle: [CONTACT_TOPICS.find((t) => t.value === topic)?.title, at ? new Date(at).toLocaleString() : null].filter(Boolean).join(" · "),
    }),
  },
});
