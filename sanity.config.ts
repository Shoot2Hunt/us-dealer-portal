"use client";

import { defineConfig } from "sanity";
import { structureTool, type StructureBuilder } from "sanity/structure";
import { visionTool } from "@sanity/vision";
// @sanity/icons v5: each icon is imported from its own path.
import { AddIcon } from "@sanity/icons/Add";
import { BlockElementIcon } from "@sanity/icons/BlockElement";
import { CheckmarkCircleIcon } from "@sanity/icons/CheckmarkCircle";
import { ClockIcon } from "@sanity/icons/Clock";
import { ColorWheelIcon } from "@sanity/icons/ColorWheel";
import { ControlsIcon } from "@sanity/icons/Controls";
import { EnvelopeIcon } from "@sanity/icons/Envelope";
import { InboxIcon } from "@sanity/icons/Inbox";
import { LockIcon } from "@sanity/icons/Lock";
import { MenuIcon } from "@sanity/icons/Menu";
import { PlugIcon } from "@sanity/icons/Plug";
import { SparklesIcon } from "@sanity/icons/Sparkles";
import { TagIcon } from "@sanity/icons/Tag";
import { apiVersion, dataset, projectId } from "./src/sanity/env";
import { PORTAL_CREATED, schemaTypes, SINGLETONS } from "./src/sanity/schemaTypes";
import { statisticsTool } from "./src/sanity/tools/statistics";
import { QUICK_ACTION_RULES, quickHeaderActions } from "./src/sanity/components/document-actions";
import { DocumentListPane, type DocumentListOptions } from "./src/sanity/components/document-list-pane";

for (const t of SINGLETONS) QUICK_ACTION_RULES.noActions.add(t);
for (const t of PORTAL_CREATED) QUICK_ACTION_RULES.noDuplicate.add(t);

const singleton = (S: StructureBuilder, type: string, title: string, icon?: React.ComponentType) =>
  S.listItem().title(title).id(type).icon(icon).child(S.document().schemaType(type).documentId(type).title(title));

/**
 * A document list with Duplicate/Delete buttons that appear on the right when you hover
 * a document (src/sanity/components/document-list-pane.tsx). Opens documents in the next
 * pane, with a "Create" button in the list header unless `canCreate` is false.
 */
function docList(S: StructureBuilder, id: string, title: string, options: DocumentListOptions, icon?: React.ComponentType, canCreate = true) {
  return S.listItem()
    .id(id)
    .title(title)
    .icon(icon ?? S.documentTypeListItem(options.type).getIcon())
    .child(
      S.component(DocumentListPane)
        .id(id)
        .title(title)
        .options(options)
        .menuItems(
          canCreate
            ? [S.menuItem().title(`New ${title.replace(/s$/, "").toLowerCase()}`).icon(AddIcon).intent({ type: "create", params: { type: options.type } }).showAsAction(true)]
            : [],
        )
        .child((docId: string) => S.document().documentId(docId).schemaType(options.type)),
    );
}

const inbox = (S: StructureBuilder, title: string, status: string | null, icon: React.ComponentType) =>
  docList(
    S,
    status ?? "all",
    title,
    {
      type: "contactSubmission",
      filter: status ? `coalesce(status, "new") == $status` : undefined,
      params: status ? { status } : undefined,
      emptyText: status === "new" ? "No new messages." : "No messages here.",
    },
    icon,
    false,
  );

export default defineConfig({
  basePath: "/studio",
  title: "Dealer Portal Admin",
  projectId,
  dataset,
  schema: {
    types: schemaTypes,
    // Settings are single documents and contact messages come from the portal: hide both from "create new".
    templates: (templates) => templates.filter(({ schemaType }) => !SINGLETONS.includes(schemaType) && !PORTAL_CREATED.includes(schemaType)),
  },
  document: {
    // Delete and Duplicate live in the document header, next to the close button
    // (see quickHeaderActions), so they're removed from the "⋯" menu at the bottom.
    actions: (actions, { schemaType }) => {
      if (SINGLETONS.includes(schemaType)) {
        return actions.filter(({ action }) => action && ["publish", "discardChanges", "restore"].includes(action));
      }
      return actions.filter(({ action }) => action !== "delete" && action !== "duplicate");
    },
    unstable_fieldActions: (prev) => [...prev, ...quickHeaderActions],
  },
  tools: (prev) => [...prev, statisticsTool],
  plugins: [
    structureTool({
      structure: (S) =>
        // One flat menu: each group's items sit directly under a titled divider, instead of
        // opening another column to the right.
        S.list()
          .title("Dealer Portal")
          .items([
            S.divider().title("Inbox"),
            inbox(S, "New messages", "new", EnvelopeIcon),
            inbox(S, "In progress", "in_progress", ClockIcon),
            inbox(S, "Resolved", "resolved", CheckmarkCircleIcon),
            inbox(S, "All messages", null, InboxIcon),

            S.divider().title("Catalog"),
            docList(S, "brand", "Brands", { type: "brand" }),
            docList(S, "productOverride", "Product settings", { type: "productOverride" }, ControlsIcon),

            S.divider().title("Promotions & codes"),
            docList(S, "promotion", "Promotions", { type: "promotion" }, SparklesIcon),
            docList(S, "discountCode", "Discount codes", { type: "discountCode" }, TagIcon),

            S.divider().title("Content"),
            docList(S, "announcement", "Announcements", { type: "announcement" }),
            docList(S, "page", "Pages", { type: "page" }),

            S.divider().title("Appearance"),
            singleton(S, "themeSettings", "Theme", ColorWheelIcon),
            singleton(S, "headerSettings", "Header", MenuIcon),
            singleton(S, "footerSettings", "Footer", BlockElementIcon),

            S.divider().title("Settings"),
            singleton(S, "siteSettings", "Portal settings"),
            singleton(S, "paymentSettings", "Payment settings"),
            singleton(S, "securitySettings", "Security", LockIcon),
            singleton(S, "pluginSettings", "Plugins", PlugIcon),
          ]),
    }),
    visionTool({ defaultApiVersion: apiVersion }),
  ],
});
