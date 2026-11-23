import { defineArrayMember, defineField, defineType } from "sanity";

/** Store keys, matching src/lib/woo/stores.ts (that file is server-only, so listed here too). */
export const BRAND_OPTIONS = [
  { title: "Unknown Suppressors", value: "unknown-suppressors" },
  { title: "Unknown Munitions", value: "unknown-munitions" },
  { title: "Salmon River Solutions", value: "salmon-river-solutions" },
  { title: "Shoot2Hunt", value: "shoot2hunt" },
];

/** "What does this apply to?" fields shared by promotions and discount codes. */
const scopeFields = (what: string) => [
  defineField({
    name: "brands",
    title: "Brands",
    description: `Limit the ${what} to these brands. Leave all three lists empty to cover everything.`,
    type: "array",
    of: [defineArrayMember({ type: "string" })],
    options: { list: BRAND_OPTIONS, layout: "grid" },
    fieldset: "scope",
  }),
  defineField({
    name: "categories",
    title: "Category slugs",
    description: "WooCommerce category slugs, e.g. suppressors or ammo-9mm.",
    type: "array",
    of: [defineArrayMember({ type: "string" })],
    options: { layout: "tags" },
    fieldset: "scope",
  }),
  defineField({
    name: "skus",
    title: "SKUs",
    type: "array",
    of: [defineArrayMember({ type: "string" })],
    options: { layout: "tags" },
    fieldset: "scope",
  }),
];

const dateFields = [
  defineField({ name: "startsAt", title: "Starts", description: "Leave blank to start right away.", type: "datetime", fieldset: "dates" }),
  defineField({
    name: "endsAt",
    title: "Ends",
    description: "Leave blank to run until you turn it off.",
    type: "datetime",
    fieldset: "dates",
    validation: (r) =>
      r.custom((end, ctx) => {
        const start = (ctx.parent as { startsAt?: string } | undefined)?.startsAt;
        return !end || !start || new Date(end) > new Date(start) ? true : "Must be after the start";
      }),
  }),
];

export const promotion = defineType({
  name: "promotion",
  title: "Promotion",
  type: "document",
  fieldsets: [
    { name: "dates", title: "When it runs", options: { columns: 2 } },
    { name: "pricing", title: "Automatic sale" },
    { name: "scope", title: "What it applies to", options: { collapsible: true, collapsed: false } },
  ],
  fields: [
    defineField({ name: "title", type: "string", validation: (r) => r.required().max(80) }),
    defineField({ name: "active", title: "Turned on", type: "boolean", initialValue: true }),
    defineField({ name: "summary", title: "Short description", type: "text", rows: 3, validation: (r) => r.max(400) }),
    defineField({ name: "image", title: "Banner image", type: "image", options: { hotspot: true } }),
    ...dateFields,
    defineField({
      name: "percentOff",
      title: "Take this % off automatically",
      description: "Optional. Applied to the dealer price of everything this promotion covers while it runs, and shown as a sale. Leave blank for a showcase-only promotion.",
      type: "number",
      fieldset: "pricing",
      validation: (r) => r.min(1).max(90),
    }),
    ...scopeFields("promotion"),
    defineField({
      name: "discountCode",
      title: "Feature a discount code",
      description: "Optional. Shown on the promotion so dealers can copy it.",
      type: "reference",
      to: [{ type: "discountCode" }],
    }),
    defineField({ name: "sortOrder", type: "number", initialValue: 0 }),
  ],
  orderings: [{ title: "Sort order", name: "sort", by: [{ field: "sortOrder", direction: "asc" }] }],
  preview: {
    select: { title: "title", pct: "percentOff", active: "active", media: "image", ends: "endsAt" },
    prepare: ({ title, pct, active, media, ends }) => ({
      title: `${active === false ? "(off) " : ""}${title}`,
      subtitle: [pct ? `${pct}% off` : "Showcase", ends ? `ends ${new Date(ends).toLocaleDateString()}` : null].filter(Boolean).join(" · "),
      media,
    }),
  },
});

export const discountCode = defineType({
  name: "discountCode",
  title: "Discount code",
  type: "document",
  fieldsets: [
    { name: "dates", title: "When it works", options: { columns: 2 } },
    { name: "limits", title: "Limits", options: { columns: 2 } },
    { name: "scope", title: "What it applies to", options: { collapsible: true, collapsed: true } },
  ],
  fields: [
    defineField({
      name: "code",
      description: "What dealers type at checkout. Letters, numbers and dashes; not case-sensitive.",
      type: "string",
      validation: (r) =>
        r
          .required()
          .min(3)
          .max(30)
          .regex(/^[A-Za-z0-9-]+$/, { name: "letters, numbers and dashes" })
          .custom(async (code, ctx) => {
            if (!code) return true;
            const id = ctx.document?._id.replace(/^drafts\./, "");
            const client = ctx.getClient({ apiVersion: "2026-11-01" });
            const taken = await client.fetch<number>(
              `count(*[_type == "discountCode" && upper(code) == $code && !(_id in [$id, "drafts." + $id])])`,
              { code: code.toUpperCase(), id },
            );
            return taken ? "Another discount code already uses this" : true;
          }),
    }),
    defineField({ name: "active", title: "Turned on", type: "boolean", initialValue: true }),
    defineField({ name: "description", title: "Shown to the dealer when applied", type: "string", validation: (r) => r.max(120) }),
    defineField({
      name: "type",
      title: "Discount type",
      type: "string",
      initialValue: "percent",
      options: { list: [{ title: "% off", value: "percent" }, { title: "$ off the order", value: "amount" }], layout: "radio", direction: "horizontal" },
      validation: (r) => r.required(),
    }),
    defineField({
      name: "value",
      title: "Amount",
      description: "Percent (1–90) or dollars, depending on the type above.",
      type: "number",
      validation: (r) =>
        r.required().positive().custom((v, ctx) => ((ctx.parent as { type?: string })?.type === "percent" && typeof v === "number" && v > 90 ? "At most 90%" : true)),
    }),
    ...dateFields,
    defineField({ name: "minSubtotal", title: "Minimum order ($)", description: "Of the items the code applies to.", type: "number", fieldset: "limits", validation: (r) => r.min(0) }),
    defineField({ name: "maxUses", title: "Total uses allowed", description: "Blank = unlimited.", type: "number", fieldset: "limits", validation: (r) => r.integer().min(1) }),
    defineField({ name: "maxUsesPerDealer", title: "Uses per dealer", description: "Blank = unlimited.", type: "number", fieldset: "limits", validation: (r) => r.integer().min(1) }),
    ...scopeFields("code"),
  ],
  preview: {
    select: { code: "code", type: "type", value: "value", active: "active" },
    prepare: ({ code, type, value, active }) => ({
      title: `${active === false ? "(off) " : ""}${(code ?? "").toUpperCase()}`,
      subtitle: value ? (type === "amount" ? `$${value} off` : `${value}% off`) : "",
    }),
  },
});
