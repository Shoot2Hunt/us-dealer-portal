"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { OrderStatus, orderStatusLabel } from "@/components/status";
import { usd } from "@/lib/money";
import { bulkOrdersAction } from "./actions";

export type AdminOrderRow = {
  id: string;
  number: number;
  date: string;
  dealer: string;
  email: string;
  poNumber: string | null;
  brands: string[];
  wooIds: number[];
  needsAttention: boolean;
  status: string;
  total: number;
};

const STATUSES = ["processing", "awaiting_payment", "payment_problem", "failed", "cancelled"] as const;

export function OrdersTable({ rows, canManage }: { rows: AdminOrderRow[]; canManage: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState("");
  const [state, dispatch, pending] = useActionState(bulkOrdersAction, null);
  const visible = rows.filter((r) => selected.has(r.id));
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action || !visible.length) return;
    const n = `${visible.length} order${visible.length === 1 ? "" : "s"}`;
    const warning =
      action === "delete"
        ? `Delete ${n} for good?\n\nEach one is cancelled first: card/ACH payments are voided in Authorize.net and the brands' WooCommerce orders are cancelled. Orders with a settled charge or a received check are kept.\n\nThis can't be undone.`
        : action === "status:cancelled"
          ? `Cancel ${n}?\n\nCard/ACH payments are voided in Authorize.net and the brands' WooCommerce orders are cancelled.`
          : null;
    if (warning && !window.confirm(warning)) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
    setSelected(new Set());
    setAction("");
  }

  return (
    <div className="space-y-3">
      {state && (state.done.length > 0 || state.problems.length > 0) && (
        <div key={state.at} role="status" className={`animate-fade-up space-y-1 rounded-lg border p-3 text-sm ${state.problems.length ? "border-amber-300 bg-amber-50" : "border-green-200 bg-green-50"}`}>
          {state.done.length > 0 && (
            <p className="flex items-start gap-2 text-green-900">
              <span className="icon-[lucide--check] mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {state.done.join(" · ")}
            </p>
          )}
          {state.problems.map((p) => (
            <p key={p} className="flex items-start gap-2 text-amber-900">
              <span className="icon-[lucide--triangle-alert] mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {p}
            </p>
          ))}
        </div>
      )}

      {canManage && (
        <form
          onSubmit={submit}
          className={`sticky top-20 z-10 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-sm transition-colors ${visible.length ? "border-accent bg-accent-soft" : "border-line bg-white"}`}
        >
          {visible.map((r) => <input key={r.id} type="hidden" name="ids" value={r.id} />)}
          <span className="font-medium">{visible.length ? `${visible.length} selected` : "Select orders to change them"}</span>
          <select name="action" className="input w-auto" value={action} onChange={(e) => setAction(e.target.value)} disabled={!visible.length} aria-label="Bulk action">
            <option value="">Choose an action…</option>
            <optgroup label="Change status to">
              {STATUSES.map((s) => (
                <option key={s} value={`status:${s}`}>{orderStatusLabel(s)}{s === "cancelled" ? " (voids payments)" : ""}</option>
              ))}
            </optgroup>
            <option value="delete">Delete orders…</option>
          </select>
          {action.startsWith("status:") && action !== "status:cancelled" && (
            <label className="flex items-center gap-2">
              <input type="checkbox" name="syncWoo" defaultChecked /> Update the brands&apos; WooCommerce orders too
            </label>
          )}
          <button className={action === "delete" ? "btn bg-red-600 text-white hover:bg-red-700" : "btn-accent"} disabled={!action || !visible.length || pending}>
            {pending ? "Working…" : "Apply"}
          </button>
          {visible.length > 0 && (
            <button type="button" className="ml-auto text-accent hover:underline" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          )}
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-panel text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              {canManage && (
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOn}
                    onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              )}
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Dealer</th>
              <th className="px-3 py-2">Brands</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
              {canManage && <th className="px-3 py-2"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={canManage ? 7 : 5} className="px-3 py-10 text-center text-muted">No orders match.</td>
              </tr>
            )}
            {rows.map((r) => {
              const on = selected.has(r.id);
              return (
                <tr key={r.id} className={`border-t border-line ${on ? "bg-accent-soft/60" : ""}`}>
                  {canManage && (
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Select order #${r.number}`} checked={on} onChange={() => toggle(r.id)} />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <Link href={`/admin/orders/${r.id}`} className="font-medium text-accent hover:underline">#{r.number}</Link>
                    <span className="block text-xs text-muted">
                      {r.date}
                      {r.poNumber && ` · PO ${r.poNumber}`}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.dealer}
                    <span className="block text-xs text-muted">{r.email}</span>
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {r.brands.join(", ")}
                    {r.wooIds.length > 0 && <span className="block text-xs">Woo {r.wooIds.map((n) => `#${n}`).join(", ")}</span>}
                    {r.needsAttention && <span className="badge ml-1 bg-red-50 text-red-700">Needs attention</span>}
                  </td>
                  <td className="px-3 py-2"><OrderStatus status={r.status} /></td>
                  <td className="px-3 py-2 text-right">{usd(r.total)}</td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <Link href={`/admin/orders/${r.id}/edit`} className="inline-flex items-center gap-1 text-accent hover:underline">
                        <span className="icon-[lucide--pencil] h-3.5 w-3.5" aria-hidden="true" /> Edit
                      </Link>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
