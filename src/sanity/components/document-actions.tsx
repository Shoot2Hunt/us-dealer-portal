"use client";

import { useCallback } from "react";
import { useDocumentOperation, type DocumentFieldAction } from "sanity";
import { useRouter } from "sanity/router";
import { usePaneRouter } from "sanity/structure";
import { TrashIcon } from "@sanity/icons/Trash";
import { CopyIcon } from "@sanity/icons/Copy";

/** Studio menus: set by sanity.config.ts so this file has no schema import cycle. */
export const QUICK_ACTION_RULES = {
  /** Single settings documents: never deleted or duplicated. */
  noActions: new Set<string>(),
  /** Created by the portal (e.g. contact messages): can be deleted but not duplicated. */
  noDuplicate: new Set<string>(),
};

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

/**
 * Delete and duplicate for one document, shared by the header buttons and the list rows.
 * Delete removes both the draft and the published version, after a confirmation.
 */
export function useQuickActions(publishedId: string, type: string, onDeleted?: () => void) {
  const { delete: del, duplicate } = useDocumentOperation(publishedId, type);
  const { navigateIntent } = useRouter();

  const remove = useCallback(() => {
    if (del.disabled) return;
    if (!window.confirm("Delete this document? This removes the draft and the published version, and can't be undone.")) return;
    del.execute();
    onDeleted?.();
  }, [del, onDeleted]);

  const copy = useCallback(() => {
    if (duplicate.disabled) return;
    const id = newId();
    duplicate.execute(id);
    navigateIntent("edit", { id, type });
  }, [duplicate, navigateIntent, type]);

  return {
    remove,
    copy,
    canDelete: !del.disabled && !QUICK_ACTION_RULES.noActions.has(type),
    canDuplicate: !duplicate.disabled && !QUICK_ACTION_RULES.noActions.has(type) && !QUICK_ACTION_RULES.noDuplicate.has(type),
  };
}

/**
 * Header buttons next to the document's close button. Registered as document-level
 * "field actions" with renderAsButton, which Studio draws in the document header.
 * Hidden on individual fields (only the document root, path []).
 */
function headerAction(kind: "delete" | "duplicate"): DocumentFieldAction {
  return {
    name: `quick-${kind}`,
    useAction(props) {
      const pane = usePaneRouter();
      const actions = useQuickActions(props.documentId, props.documentType, pane.closeCurrent);
      const atRoot = props.path.length === 0;
      if (kind === "delete") {
        return {
          type: "action",
          title: "Delete",
          icon: TrashIcon,
          tone: "critical",
          renderAsButton: true,
          hidden: !atRoot || QUICK_ACTION_RULES.noActions.has(props.documentType),
          disabled: !actions.canDelete,
          onAction: actions.remove,
        };
      }
      return {
        type: "action",
        title: "Duplicate",
        icon: CopyIcon,
        renderAsButton: true,
        hidden: !atRoot || QUICK_ACTION_RULES.noActions.has(props.documentType) || QUICK_ACTION_RULES.noDuplicate.has(props.documentType),
        disabled: !actions.canDuplicate,
        onAction: actions.copy,
      };
    },
  };
}

export const quickHeaderActions: DocumentFieldAction[] = [headerAction("duplicate"), headerAction("delete")];
