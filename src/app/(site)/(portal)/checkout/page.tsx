import { requireUser } from "@/lib/auth/session";
import { getPaymentSettings } from "@/sanity/content";
import { authnetConfig } from "@/lib/authnet";
import { CheckoutForm } from "./checkout-form";

export default async function CheckoutPage() {
  const user = await requireUser();
  const settings = await getPaymentSettings();
  // Card/ACH need Authorize.net keys (Admin → Payments). Without them only mailed checks are offered.
  const online = authnetConfig().ready;
  const acceptJsUrl =
    process.env.AUTHNET_ENV === "production" ? "https://js.authorize.net/v1/Accept.js" : "https://jstest.authorize.net/v1/Accept.js";
  return (
    <CheckoutForm
      settings={settings}
      onlinePayments={online}
      defaultAddress={user.shippingAddress ?? { firstName: user.name.split(" ")[0] ?? "", lastName: user.name.split(" ").slice(1).join(" "), company: user.company ?? "", address1: "", city: "", state: "", postcode: "", phone: user.phone ?? "" }}
      acceptJs={{
        url: acceptJsUrl,
        apiLoginId: process.env.NEXT_PUBLIC_AUTHNET_API_LOGIN_ID ?? "",
        clientKey: process.env.NEXT_PUBLIC_AUTHNET_CLIENT_KEY ?? "",
      }}
    />
  );
}
