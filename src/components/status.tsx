const ORDER: Record<string, [string, string]> = {
  processing: ["Processing", "bg-green-50 text-green-800"],
  awaiting_payment: ["Waiting for payment", "bg-amber-50 text-amber-800"],
  payment_problem: ["Payment problem", "bg-red-50 text-red-700"],
  failed: ["Failed", "bg-red-50 text-red-700"],
  cancelled: ["Cancelled", "bg-panel text-muted"],
};

const PAYMENT: Record<string, string> = {
  authorized: "Authorized",
  captured: "Paid",
  pending_settlement: "Clearing",
  settled: "Paid",
  awaiting_check: "Waiting for check",
  received: "Check received",
  declined: "Declined",
  voided: "Voided",
  returned: "Returned",
  invoiced: "Invoiced, not yet paid",
  superseded: "Paid another way",
};

export function OrderStatus({ status }: { status: string }) {
  const [label, cls] = ORDER[status] ?? [status, "bg-panel text-muted"];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export const paymentLabel = (s: string) => PAYMENT[s] ?? s;
export const methodLabel = (m: string) => (m === "ach" ? "ACH" : m === "card" ? "Card" : m === "terms" ? "Invoice" : "Check");
