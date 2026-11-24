import { defineField, defineType } from "sanity";
import { NAV_ICONS } from "./site";

type Parent = { kind?: string; source?: string; showAsPage?: boolean } | undefined;
const parentOf = (p: unknown) => p as Parent;

/**
 * Admin-uploaded programs ("custom plugins"). Two kinds:
 *  - app:    HTML/JS run in a sealed sandbox (no access to the portal's session, cookies or
 *            data). Shown as its own page and/or embedded on portal pages.
 *  - script: code injected into the portal's pages with full access (chat widgets, pixels).
 *            Only switched on after an explicit acknowledgement.
 */
export const customPlugin = defineType({
  name: "customPlugin",
  title: "Custom plugin",
  type: "document",
  groups: [
    { name: "main", title: "Plugin", default: true },
    { name: "placement", title: "Where it shows" },
  ],
  fields: [
    defineField({ name: "name", type: "string", group: "main", validation: (r) => r.required().max(60) }),
    defineField({ name: "enabled", title: "Turned on", type: "boolean", initialValue: false, group: "main" }),
    defineField({ name: "description", title: "Notes (for admins)", type: "text", rows: 2, group: "main" }),
    defineField({
      name: "kind",
      title: "Type",
      type: "string",
      group: "main",
      initialValue: "app",
      validation: (r) => r.required(),
      options: {
        layout: "radio",
        list: [
          { title: "App: runs in a secure sandbox (recommended)", value: "app" },
          { title: "Site script: runs directly on portal pages with full access", value: "script" },
        ],
      },
    }),
    defineField({
      name: "source",
      title: "Code from",
      type: "string",
      group: "main",
      initialValue: "upload",
      options: { layout: "radio", direction: "horizontal", list: [{ title: "Upload a file", value: "upload" }, { title: "Paste code", value: "paste" }] },
    }),
    defineField({
      name: "file",
      title: "Program file",
      description: "Apps: an .html file (it can include its own <script> and <style>). Site scripts: a .js file.",
      type: "file",
      group: "main",
      options: { accept: ".html,.htm,.js,text/html,text/javascript,application/javascript" },
      hidden: ({ parent }) => parentOf(parent)?.source === "paste",
    }),
    defineField({
      name: "code",
      title: "Code",
      description: "Apps: a full HTML document or fragment. Site scripts: HTML snippet as given by the vendor (e.g. <script>…</script>).",
      type: "text",
      rows: 14,
      group: "main",
      hidden: ({ parent }) => parentOf(parent)?.source !== "paste",
      validation: (r) => r.max(500_000),
    }),

    // --- Apps ---
    defineField({
      name: "showAsPage",
      title: "Give it its own page",
      description: "At /apps/<slug>, for signed-in users.",
      type: "boolean",
      initialValue: true,
      group: "placement",
      hidden: ({ parent }) => parentOf(parent)?.kind !== "app",
    }),
    defineField({
      name: "slug",
      type: "slug",
      group: "placement",
      options: { source: "name" },
      hidden: ({ parent }) => parentOf(parent)?.kind !== "app" || !parentOf(parent)?.showAsPage,
      validation: (r) =>
        r.custom((v, ctx) => {
          const p = parentOf(ctx.parent);
          return p?.kind === "app" && p?.showAsPage && !(v as { current?: string } | undefined)?.current ? "Needed for the app's page" : true;
        }),
    }),
    defineField({
      name: "menuLabel",
      title: "Link in the header menu",
      description: "Leave blank to keep the page out of the menu (link to it yourself).",
      type: "string",
      group: "placement",
      hidden: ({ parent }) => parentOf(parent)?.kind !== "app" || !parentOf(parent)?.showAsPage,
    }),
    defineField({
      name: "menuIcon",
      title: "Menu icon",
      type: "string",
      group: "placement",
      options: { list: NAV_ICONS },
      hidden: ({ parent }) => parentOf(parent)?.kind !== "app" || !parentOf(parent)?.showAsPage,
    }),
    defineField({
      name: "embeds",
      title: "Also show it on",
      type: "array",
      group: "placement",
      of: [{ type: "string" }],
      options: {
        list: [
          { title: "Top of the Inventory page", value: "inventory" },
          { title: "Product pages (below the details)", value: "product" },
        ],
      },
      hidden: ({ parent }) => parentOf(parent)?.kind !== "app",
    }),
    defineField({
      name: "audience",
      title: "Who sees it",
      type: "string",
      group: "placement",
      initialValue: "all",
      options: { layout: "radio", list: [{ title: "Dealers and admins", value: "all" }, { title: "Admins only (for testing)", value: "admins" }] },
      hidden: ({ parent }) => parentOf(parent)?.kind !== "app",
    }),
    defineField({
      name: "height",
      title: "Height (pixels)",
      description: "Starting height. Apps can resize themselves (see the developer notes on the app's page).",
      type: "number",
      initialValue: 600,
      group: "placement",
      validation: (r) => r.min(100).max(4000),
      hidden: ({ parent }) => parentOf(parent)?.kind !== "app",
    }),
    defineField({
      name: "shareProfile",
      title: "Share the viewer's name and company with the app",
      type: "boolean",
      initialValue: false,
      group: "placement",
      hidden: ({ parent }) => parentOf(parent)?.kind !== "app",
    }),

    // --- Site scripts ---
    defineField({
      name: "scriptScope",
      title: "Run on",
      type: "string",
      group: "placement",
      initialValue: "portal",
      options: { layout: "radio", list: [{ title: "Signed-in portal pages", value: "portal" }, { title: "Every page, including sign-in and public pages", value: "all" }] },
      hidden: ({ parent }) => parentOf(parent)?.kind !== "script",
    }),
    defineField({
      name: "acknowledged",
      title: "I understand this code runs with full access to signed-in dealers' and admins' sessions, and I trust its source",
      description: "Site scripts stay off until this is ticked. Only add code from vendors you trust.",
      type: "boolean",
      initialValue: false,
      group: "main",
      hidden: ({ parent }) => parentOf(parent)?.kind !== "script",
    }),
  ],
  preview: {
    select: { title: "name", kind: "kind", enabled: "enabled" },
    prepare: ({ title, kind, enabled }) => ({
      title: `${enabled ? "" : "(off) "}${title ?? "Untitled plugin"}`,
      subtitle: kind === "script" ? "Site script" : "Sandboxed app",
    }),
  },
});
