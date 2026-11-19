import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getOrderForUser } from "@/lib/orders";
import { OrderDetail } from "@/components/order-detail";

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const [{ id }, { placed }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const detail = await getOrderForUser(user, id).catch(() => null);
  if (!detail) notFound();
  return (
    <div className="space-y-4">
      {placed && (
        <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
          Thanks — your order was placed. A confirmation email is on its way.
        </div>
      )}
      <OrderDetail detail={detail} />
    </div>
  );
}
