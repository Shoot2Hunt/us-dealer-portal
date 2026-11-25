"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { bulkSetStatus, deleteOrders, editOrder, editOrderSchema, ORDER_STATUSES, type BulkResult, type OrderStatusValue } from "@/lib/admin-orders";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrdersActionState = (BulkResult & { at: number }) | null;

/** Bulk actions from the orders list: change status, or delete. Super admins only. */
export async function bulkOrdersAction(_: OrdersActionState, form: FormData): Promise<OrdersActionState> {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return { done: [], problems: ["Only super admins can change orders in bulk."], at: Date.now() };
  const ids = [...new Set(form.getAll("ids").map(String).filter((id) => UUID.test(id)))].slice(0, 200);
  const action = String(form.get("action") ?? "");
  if (!ids.length) return { done: [], problems: ["Select at least one order."], at: Date.now() };

  let result: BulkResult;
  if (action === "delete") {
    const r = await deleteOrders(ids, { by: admin.email });
    // The audit log keeps a full copy of what was deleted.
    await audit(admin, "order.bulk_delete", undefined, { ids, done: r.done, problems: r.problems, deleted: r.snapshots });
    result = r;
  } else if (action.startsWith("status:") && (ORDER_STATUSES as readonly string[]).includes(action.slice(7))) {
    const status = action.slice(7) as OrderStatusValue;
    result = await bulkSetStatus(ids, status, { syncWoo: form.get("syncWoo") === "on", by: admin.email });
    await audit(admin, "order.bulk_status", undefined, { ids, status, done: result.done, problems: result.problems });
  } else {
    return { done: [], problems: ["Pick an action."], at: Date.now() };
  }
  revalidatePath("/admin/orders");
  revalidatePath("/orders");
  revalidatePath("/billing");
  return { ...result, at: Date.now() };
}

/** Save the edit form for one order. */
export async function editOrderAction(_: OrdersActionState, form: FormData): Promise<OrdersActionState> {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") return { done: [], problems: ["Only super admins can edit orders."], at: Date.now() };
  const orderId = String(form.get("orderId") ?? "");
  if (!UUID.test(orderId)) return { done: [], problems: ["Order not found."], at: Date.now() };
  const s = (k: string) => String(form.get(k) ?? "");
  const parsed = editOrderSchema.safeParse({
    status: s("status"),
    shipping: {
      firstName: s("firstName"), lastName: s("lastName"), company: s("company") || undefined, address1: s("address1"), address2: s("address2") || undefined,
      city: s("city"), state: s("state"), postcode: s("postcode"), phone: s("phone") || undefined,
    },
    poNumber: s("poNumber"),
    notes: s("notes"),
    dueDate: s("dueDate"),
    syncWoo: form.get("syncWoo") === "on",
  });
  if (!parsed.success) return { done: [], problems: parsed.error.issues.map((i) => i.message), at: Date.now() };
  const r = await editOrder(orderId, parsed.data, admin.email);
  await audit(admin, "order.edit", `order:${orderId}`, { changes: parsed.data, done: r.done, problems: r.problems });
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ...r, at: Date.now() };
}

/** Delete one order (from its own page). */
export async function deleteOrderAction(_: OrdersActionState, form: FormData): Promise<OrdersActionState> {
  const r = await bulkOrdersAction(null, (() => {
    const f = new FormData();
    f.append("ids", String(form.get("orderId") ?? ""));
    f.append("action", "delete");
    return f;
  })());
  return r;
}
