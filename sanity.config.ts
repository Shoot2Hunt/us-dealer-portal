"use client";

import { defineConfig } from "sanity";
import { structureTool, type StructureBuilder } from "sanity/structure";
import { visionTool } from "@sanity/vision";
// @sanity/icons v5: each icon is imported from its own path.
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

const singleton = (S: StructureBuilder, type: string, title: string, icon?: React.ComponentType) =>
  S.listItem().title(title).id(type).icon(icon).child(S.document().schemaType(type).documentId(type).title(title));

const inbox = (S: StructureBuilder, title: string, status: string | null, icon: React.ComponentType) =>
  S.listItem()
    .title(title)
    .id(status ?? "all")
    .icon(icon)
    .child(
      S.documentList()
        .title(title)
        .schemaType("contactSubmission")
        .filter(status ? `_type == "contactSubmission" && coalesce(status, "new") == $status` : `_type == "contactSubmission"`)
        .params(status ? { status } : {})
        .defaultOrdering([{ field: "submittedAt", direction: "desc" }]),
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
    actions: (actions, { schemaType }) => {
      if (SINGLETONS.includes(schemaType)) {
        return actions.filter(({ action }) => action && ["publish", "discardChanges", "restore"].includes(action));
      }
      if (PORTAL_CREATED.includes(schemaType)) return actions.filter(({ action }) => action !== "duplicate");
      return actions;
    },
  },
  tools: (prev) => [...prev, statisticsTool],
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title("Dealer Portal")
          .items([
            S.listItem()
              .title("Inbox")
              .id("inbox")
              .icon(InboxIcon)
              .child(
                S.list()
                  .title("Contact messages")
                  .items([
                    inbox(S, "New", "new", EnvelopeIcon),
                    inbox(S, "In progress", "in_progress", ClockIcon),
                    inbox(S, "Resolved", "resolved", CheckmarkCircleIcon),
                    S.divider(),
                    inbox(S, "All messages", null, InboxIcon),
                  ]),
              ),
            S.divider(),
            S.listItem().title("Portal settings").id("siteSettings").child(S.document().schemaType("siteSettings").documentId("siteSettings")),
            S.listItem().title("Payment settings").id("paymentSettings").child(S.document().schemaType("paymentSettings").documentId("paymentSettings")),
            S.listItem()
              .title("Appearance")
              .id("appearance")
              .icon(ColorWheelIcon)
              .child(
                S.list()
                  .title("Appearance")
                  .items([
                    singleton(S, "themeSettings", "Theme", ColorWheelIcon),
                    singleton(S, "headerSettings", "Header", MenuIcon),
                    singleton(S, "footerSettings", "Footer", BlockElementIcon),
                  ]),
              ),
            singleton(S, "securitySettings", "Security", LockIcon),
            singleton(S, "pluginSettings", "Plugins", PlugIcon),
            S.divider(),
            S.documentTypeListItem("brand").title("Brands"),
            S.documentTypeListItem("productOverride").title("Product settings").icon(ControlsIcon),
            S.listItem()
              .title("Promotions & codes")
              .id("promotions")
              .icon(SparklesIcon)
              .child(
                S.list()
                  .title("Promotions & codes")
                  .items([
                    S.documentTypeListItem("promotion").title("Promotions").icon(SparklesIcon),
                    S.documentTypeListItem("discountCode").title("Discount codes").icon(TagIcon),
                  ]),
              ),
            S.documentTypeListItem("announcement").title("Announcements"),
            S.documentTypeListItem("page").title("Pages"),
          ]),
    }),
    visionTool({ defaultApiVersion: apiVersion }),
  ],
});
