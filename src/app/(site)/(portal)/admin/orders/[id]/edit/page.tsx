import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getOrderForUser } from "@/lib/orders";
import { EditOrderForm } from "./edit-form";

export default async function EditOrderPage({ params }: PageProps<"/admin/orders/[id]/edit">) {
  const { id } = await params;
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") redirect(`/admin/orders/${id}`);
  const detail = await getOrderForUser(admin, id).catch(() => null);
  if (!detail) notFound();
  const { order } = detail;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/admin/orders/${order.id}`} className="text-sm text-accent hover:underline">← Order #{order.number}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit order #{order.number}</h1>
        <p className="text-sm text-muted">
          Change the status, ship-to address, PO number, notes or due date. Items and prices can&apos;t be changed here, since
          they were already charged; cancel the order and place a new one instead.
        </p>
      </div>
      <EditOrderForm
        order={{
          id: order.id,
          number: order.number,
          status: order.status,
          shipping: order.shippingAddress,
          poNumber: order.poNumber ?? "",
          notes: order.notes ?? "",
          dueDate: order.dueDate ?? "",
          hasWoo: detail.storeOrders.some((s) => s.wooOrderId),
        }}
      />
    </div>
  );
}
