"use client";

import { useEffect, useMemo, useState } from "react";
import { Box, Button, Card, Flex, Spinner, Stack, Text, TextInput } from "@sanity/ui";
import { Preview, useClient, useSchema } from "sanity";
import { usePaneRouter } from "sanity/structure";
import { TrashIcon } from "@sanity/icons/Trash";
import { CopyIcon } from "@sanity/icons/Copy";
import { SearchIcon } from "@sanity/icons/Search";
import { useQuickActions } from "./document-actions";

export type DocumentListOptions = {
  type: string;
  /** Extra GROQ filter, e.g. `coalesce(status, "new") == $status`. */
  filter?: string;
  params?: Record<string, unknown>;
  emptyText?: string;
};

type Row = { id: string; previewId: string; search: string };

const API_VERSION = "2026-11-01";
const publishedId = (id: string) => id.replace(/^drafts\./, "");

/** Hover-to-show actions on the right of each row (and while a row has keyboard focus). */
const STYLES = `
.dp-row { position: relative; }
.dp-row > a { display: block; color: inherit; text-decoration: none; border-radius: 4px; }
.dp-row .dp-actions { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); display: flex; gap: 2px;
  opacity: 0; pointer-events: none; transition: opacity 120ms ease; border-radius: 4px;
  background: var(--card-bg-color); box-shadow: 0 0 0 1px var(--card-border-color); padding: 2px; }
.dp-row:hover .dp-actions, .dp-row:focus-within .dp-actions { opacity: 1; pointer-events: auto; }
`;

/**
 * Document list for Studio's menu, like the built-in one but with Duplicate and Delete
 * buttons that appear on the right when you hover a document. Opens documents in the
 * next pane exactly like the built-in list.
 */
export function DocumentListPane(props: { options?: Record<string, unknown>; childItemId?: string }) {
  const { type, filter, params, emptyText } = (props.options ?? { type: "" }) as DocumentListOptions;
  const client = useClient({ apiVersion: API_VERSION });
  const schemaType = useSchema().get(type);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const paramsKey = JSON.stringify(params ?? {});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const groq = `*[_type == $type${filter ? ` && (${filter})` : ""}] | order(_updatedAt desc) [0...1000]{
      _id, "search": lower(array::join([coalesce(title, ""), coalesce(name, ""), coalesce(label, ""), coalesce(code, ""), coalesce(sku, ""), coalesce(email, "")], " "))
    }`;
    const allParams = { ...(JSON.parse(paramsKey) as Record<string, unknown>), type };
    const load = async () => {
      try {
        const docs = await client.fetch<{ _id: string; search: string }[]>(groq, allParams, { perspective: "raw" });
        // One row per document: the draft when there is one (so the preview shows unsaved edits).
        const byId = new Map<string, Row>();
        for (const d of docs) {
          const id = publishedId(d._id);
          if (d._id.startsWith("versions.")) continue;
          const existing = byId.get(id);
          if (!existing || d._id.startsWith("drafts.")) byId.set(id, { id, previewId: d._id, search: d.search ?? existing?.search ?? "" });
        }
        if (!cancelled) {
          setRows([...byId.values()]);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    // Live: refetch shortly after any change to documents of this type.
    const sub = client.listen(`*[_type == $type]`, { type }, { visibility: "query", includeResult: false }).subscribe({
      next: () => {
        clearTimeout(timer);
        timer = setTimeout(load, 400);
      },
      error: () => {},
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      sub.unsubscribe();
    };
  }, [client, type, filter, paramsKey]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q && rows ? rows.filter((r) => r.search.includes(q)) : rows;
  }, [rows, query]);

  if (!schemaType) return <Box padding={4}><Text size={1}>Unknown document type “{type}”.</Text></Box>;

  return (
    <Stack gap={2} padding={2}>
      <style>{STYLES}</style>
      <TextInput icon={SearchIcon} fontSize={1} placeholder="Search…" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      {error && <Card padding={3} tone="critical" radius={2}><Text size={1}>Couldn&apos;t load documents: {error}</Text></Card>}
      {!shown && !error && <Flex justify="center" padding={4}><Spinner muted /></Flex>}
      {shown?.length === 0 && (
        <Box padding={3}><Text size={1} muted>{query ? "No documents match." : emptyText ?? "No documents yet."}</Text></Box>
      )}
      {shown && shown.length > 0 && (
        <Stack gap={1}>
          {shown.map((r) => (
            <ListRow key={r.id} row={r} type={type} schemaType={schemaType} selected={props.childItemId === r.id} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function ListRow({ row, type, schemaType, selected }: { row: Row; type: string; schemaType: NonNullable<ReturnType<ReturnType<typeof useSchema>["get"]>>; selected: boolean }) {
  const { ChildLink } = usePaneRouter();
  const actions = useQuickActions(row.id, type);
  return (
    <div className="dp-row">
      <ChildLink childId={row.id}>
        <Card padding={1} radius={2} tone={selected ? "primary" : "default"} pressed={selected} selected={selected} __unstable_focusRing>
          <Preview schemaType={schemaType} value={{ _id: row.previewId, _type: type }} layout="default" />
        </Card>
      </ChildLink>
      {(actions.canDuplicate || actions.canDelete) && (
        <div className="dp-actions">
          {actions.canDuplicate && (
            <Button icon={CopyIcon} mode="bleed" fontSize={1} padding={2} title="Duplicate" aria-label="Duplicate" onClick={actions.copy} />
          )}
          {actions.canDelete && (
            <Button icon={TrashIcon} mode="bleed" tone="critical" fontSize={1} padding={2} title="Delete" aria-label="Delete" onClick={actions.remove} />
          )}
        </div>
      )}
    </div>
  );
}
