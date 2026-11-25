"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useState } from "react";
import type { Address } from "@/lib/db/schema";
import { orderStatusLabel } from "@/components/status";
import { PhoneInput } from "@/components/phone-input";
import { deleteOrderAction, editOrderAction } from "../../actions";

const STATUSES = ["processing", "awaiting_payment", "payment_problem", "failed", "cancelled"] as const;

type EditableOrder = {
  id: string;
  number: number;
  status: string;
  shipping: Address;
  poNumber: string;
  notes: string;
  dueDate: string;
  hasWoo: boolean;
};

export function EditOrderForm({ order }: { order: EditableOrder }) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(editOrderAction, null);
  const [deleteState, dispatchDelete, deleting] = useActionState(deleteOrderAction, null);
  const [status, setStatus] = useState(order.status);
  const [phone, setPhone] = useState(order.shipping.phone ?? "");
  const deleted = Boolean(deleteState?.done.some((d) => d.endsWith("deleted")));

  function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "cancelled" && order.status !== "cancelled" && !window.confirm(`Cancel order #${order.number}?\n\nCard/ACH payments are voided in Authorize.net and the brands' WooCommerce orders are cancelled.`)) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  function remove() {
    if (!window.confirm(`Delete order #${order.number} for good?\n\nIt's cancelled first (payments voided, WooCommerce orders cancelled). An order with a settled charge or a received check is kept.\n\nThis can't be undone.`)) return;
    const fd = new FormData();
    fd.append("orderId", order.id);
    startTransition(() => dispatchDelete(fd));
  }

  if (deleted) {
    return (
      <div className="card space-y-3 text-center">
        <p className="font-medium">Order #{order.number} was deleted.</p>
        <button className="btn mx-auto" onClick={() => router.push("/admin/orders")}>Back to orders</button>
      </div>
    );
  }

  const a = order.shipping;
  const field = (name: keyof Address, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={`f-${name}`}>{label}</label>
      <input id={`f-${name}`} name={name} className="input" defaultValue={a[name] ?? ""} {...props} />
    </div>
  );

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="space-y-6">
        <input type="hidden" name="orderId" value={order.id} />

        <section className="card space-y-4">
          <h2 className="font-semibold">Status</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="status">Order status</label>
              <select id="status" name="status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{orderStatusLabel(s)}</option>)}
              </select>
              {status === "cancelled" && order.status !== "cancelled" && (
                <p className="mt-1 text-xs text-amber-800">Saving cancels the order: payments are voided in Authorize.net and the WooCommerce orders are cancelled.</p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="dueDate">Payment due date</label>
              <input id="dueDate" name="dueDate" type="date" className="input" defaultValue={order.dueDate} />
              <p className="mt-1 text-xs text-muted">For invoiced and check orders. Leave empty for due on receipt.</p>
            </div>
          </div>
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold">Ship to</h2>
          <div className="grid grid-cols-2 gap-3">
            {field("firstName", "First name", { required: true })}
            {field("lastName", "Last name", { required: true })}
          </div>
          {field("company", "Business")}
          {field("address1", "Address", { required: true })}
          {field("address2", "Address line 2")}
          <div className="grid grid-cols-3 gap-3">
            {field("city", "City", { required: true })}
            {field("state", "State", { required: true, minLength: 2, maxLength: 2, pattern: "[A-Za-z]{2}", title: "2-letter state code, e.g. ID" })}
            {field("postcode", "ZIP", { required: true, pattern: "[0-9]{5}(-[0-9]{4})?", title: "5-digit ZIP code", inputMode: "numeric", maxLength: 10 })}
          </div>
          <div className="sm:w-1/2">
            <label className="label" htmlFor="f-phone">Phone</label>
            <PhoneInput id="f-phone" value={phone} onChange={setPhone} />
            <input type="hidden" name="phone" value={phone} />
          </div>
        </section>

        <section className="card space-y-4">
          <h2 className="font-semibold">Details</h2>
          <div className="sm:w-1/2">
            <label className="label" htmlFor="poNumber">PO number</label>
            <input id="poNumber" name="poNumber" className="input" maxLength={50} defaultValue={order.poNumber} />
          </div>
          <div>
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" className="input min-h-24" maxLength={1000} defaultValue={order.notes} />
          </div>
        </section>

        {state && (state.done.length > 0 || state.problems.length > 0) && (
          <div key={state.at} role="status" className={`animate-fade-up space-y-1 rounded-lg border p-3 text-sm ${state.problems.length ? "border-amber-300 bg-amber-50" : "border-green-200 bg-green-50"}`}>
            {state.done.length > 0 && <p className="text-green-900">✓ {state.done.join(" · ")}</p>}
            {state.problems.map((p) => <p key={p} className="text-amber-900">⚠ {p}</p>)}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {order.hasWoo && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="syncWoo" defaultChecked /> Update the brands&apos; WooCommerce orders too (status, address, PO)
            </label>
          )}
          <div className="ml-auto flex gap-2">
            <Link href={`/admin/orders/${order.id}`} className="btn-ghost">Back</Link>
            <button className="btn-accent" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      </form>

      <section className="card space-y-3 border-red-200">
        <h2 className="font-semibold text-red-700">Delete order</h2>
        <p className="text-sm text-muted">
          Removes the order from the portal for good (a copy is kept in the audit log). It&apos;s cancelled first, so payments are
          voided and the WooCommerce orders cancelled.
        </p>
        {deleteState && deleteState.problems.map((p) => <p key={p} className="rounded bg-amber-50 p-2 text-sm text-amber-900">⚠ {p}</p>)}
        <button type="button" onClick={remove} className="btn bg-red-600 text-white hover:bg-red-700" disabled={deleting}>
          {deleting ? "Deleting…" : `Delete order #${order.number}`}
        </button>
      </section>
    </div>
  );
}
