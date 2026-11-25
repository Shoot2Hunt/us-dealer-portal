import { requireUser } from "@/lib/auth/session";
import { getPaymentSettings } from "@/sanity/content";
import { acceptJsConfig, authnetConfig } from "@/lib/authnet";
import { formatDue, getTermsStatus } from "@/lib/invoices";
import { CheckoutForm, type CheckoutTerms } from "./checkout-form";

export default async function CheckoutPage() {
  const user = await requireUser();
  const settings = await getPaymentSettings();
  // Card/ACH need Authorize.net keys (Admin → Payments). Without them only mailed checks are offered.
  const online = authnetConfig().ready;
  // "Invoice me" for dealers on net terms (Admin → Dealers), unless they're past due or at their limit.
  const t = await getTermsStatus(user, settings.enableTerms);
  const terms: CheckoutTerms = t.approved
    ? { days: t.days, dueLabel: formatDue(t.dueDate), available: t.available, reason: t.reason, creditAvailable: t.creditLimit === null ? null : Math.max(0, t.creditLimit - t.owed) }
    : null;
  return (
    <CheckoutForm
      settings={settings}
      onlinePayments={online}
      terms={terms}
      preferred={user.preferredPaymentMethod}
      defaultAddress={user.shippingAddress ?? { firstName: user.name.split(" ")[0] ?? "", lastName: user.name.split(" ").slice(1).join(" "), company: user.company ?? "", address1: "", city: "", state: "", postcode: "", phone: user.phone ?? "" }}
      acceptJs={acceptJsConfig()}
    />
  );
}
