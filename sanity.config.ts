"use client";

import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { apiVersion, dataset, projectId } from "./src/sanity/env";
import { schemaTypes, SINGLETONS } from "./src/sanity/schemaTypes";

export default defineConfig({
  basePath: "/studio",
  title: "Dealer Portal Admin",
  projectId,
  dataset,
  schema: {
    types: schemaTypes,
    // Settings are single documents: hide them from "create new".
    templates: (templates) => templates.filter(({ schemaType }) => !SINGLETONS.includes(schemaType)),
  },
  document: {
    actions: (actions, { schemaType }) =>
      SINGLETONS.includes(schemaType)
        ? actions.filter(({ action }) => action && ["publish", "discardChanges", "restore"].includes(action))
        : actions,
  },
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title("Dealer Portal")
          .items([
            S.listItem().title("Portal settings").id("siteSettings").child(S.document().schemaType("siteSettings").documentId("siteSettings")),
            S.listItem().title("Payment settings").id("paymentSettings").child(S.document().schemaType("paymentSettings").documentId("paymentSettings")),
            S.divider(),
            S.documentTypeListItem("brand").title("Brands"),
            S.documentTypeListItem("productOverride").title("Product settings"),
            S.documentTypeListItem("announcement").title("Announcements"),
            S.documentTypeListItem("page").title("Pages"),
          ]),
    }),
    visionTool({ defaultApiVersion: apiVersion }),
  ],
});
