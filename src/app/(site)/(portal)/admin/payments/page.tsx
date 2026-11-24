import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { authnetConfig, checkMerchant } from "@/lib/authnet";
import { getPaymentSettings } from "@/sanity/content";

export const metadata = { title: "Payments setup" };

/** Plain-English hints for the Authorize.net errors people actually hit during setup. */
const HINTS: Record<string, string> = {
  E00007: "The API Login ID or Transaction Key is wrong. A common cause is sandbox keys with AUTHNET_ENV=production (or live keys without it). A new Transaction Key also replaces the old one.",
  E00008: "The account is inactive. Check its status in the Authorize.net Merchant Interface.",
  E00124: "The access token is invalid or expired.",
};

type Check = { label: string; ok: boolean | null; detail?: string };

export default async function PaymentsSetupPage() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") redirect("/admin");
  const cfg = authnetConfig();
  const [merchant, settings] = await Promise.all([
    cfg.apiLoginId && cfg.transactionKey ? checkMerchant() : Promise.resolve(null),
    getPaymentSettings(),
  ]);
  const live = cfg.env === "production";

  const checks: Check[] = [
    { label: "API Login ID (NEXT_PUBLIC_AUTHNET_API_LOGIN_ID)", ok: cfg.apiLoginId },
    { label: "Transaction Key (AUTHNET_TRANSACTION_KEY)", ok: cfg.transactionKey },
    { label: "Public Client Key (NEXT_PUBLIC_AUTHNET_CLIENT_KEY)", ok: cfg.clientKey },
    {
      label: "Connects to Authorize.net",
      ok: merchant ? merchant.ok : null,
      detail: merchant
        ? merchant.ok
          ? `${merchant.merchantName ?? "Account"}${merchant.gatewayId ? ` · gateway ${merchant.gatewayId}` : ""}`
          : `${merchant.error}${merchant.code ? ` (${merchant.code})` : ""}${merchant.code && HINTS[merchant.code] ? ` ${HINTS[merchant.code]}` : ""}`
        : "Add the API Login ID and Transaction Key first.",
    },
  ];
  if (merchant?.ok) {
    checks.push(
      {
        label: "Public Client Key matches this account",
        ok: merchant.clientKeyMatches,
        detail:
          merchant.clientKeyMatches === false
            ? "It belongs to a different account or is out of date. Copy it again from Account → Settings → Security Settings → Manage Public Client Key."
            : merchant.clientKeyMatches === null
              ? "Couldn't compare: generate a Public Client Key in Authorize.net first."
              : undefined,
      },
      {
        label: "Account is processing real transactions",
        ok: live ? !merchant.isTestMode : null,
        detail: live
          ? merchant.isTestMode
            ? "The live account is in Test Mode, so nothing is actually charged. Turn it off under Account → Settings → Test Mode."
            : undefined
          : "Sandbox: no real money moves. Use the test cards below.",
      },
      { label: "Accepts credit cards", ok: merchant.acceptsCards, detail: merchant.paymentMethods.join(", ") || undefined },
      {
        label: "Accepts eCheck (ACH)",
        ok: settings.enableAch ? merchant.acceptsEcheck : merchant.acceptsEcheck || null,
        detail: !merchant.acceptsEcheck
          ? settings.enableAch
            ? "ACH is turned on in Studio → Payment settings, but eCheck.Net isn't enabled on this Authorize.net account. Apply for it with Authorize.net, or turn ACH off in Studio."
            : "Not enabled on the account (ACH is also off in Studio, so that's fine)."
          : undefined,
      },
    );
  }
  checks.push({
    label: "Cron secret for ACH settlement checks (CRON_SECRET)",
    ok: Boolean(process.env.CRON_SECRET),
    detail: process.env.CRON_SECRET ? undefined : "Without it the hourly job that releases orders once an eCheck settles can't run.",
  });

  const allGood = checks.every((c) => c.ok !== false);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Payments setup</h1>
        <span className={`badge ${live ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>
          {live ? "LIVE: real charges" : "SANDBOX: test mode"}
        </span>
        <span className={`badge ${cfg.ready && allGood ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
          {cfg.ready && allGood ? "Ready for card & ACH" : "Card & ACH not ready"}
        </span>
      </div>
      <p className="text-sm text-muted">
        Card and bank details are turned into a one-time token in the dealer&apos;s browser by Authorize.net (Accept.js) and never
        touch this server. This page checks the connection each time it loads.
      </p>

      <section className="card divide-y divide-line p-0">
        {checks.map((c) => (
          <div key={c.label} className="flex items-start gap-3 px-5 py-3 text-sm">
            <span
              className={`mt-0.5 h-5 w-5 shrink-0 ${c.ok === true ? "icon-[lucide--circle-check] text-green-600" : c.ok === false ? "icon-[lucide--circle-x] text-red-600" : "icon-[lucide--circle-minus] text-muted"}`}
              aria-label={c.ok === true ? "OK" : c.ok === false ? "Problem" : "Not applicable"}
            />
            <div>
              <p className="font-medium">{c.label}</p>
              {c.detail && <p className="text-muted">{c.detail}</p>}
            </div>
          </div>
        ))}
      </section>

      <section className="card space-y-3 text-sm">
        <h2 className="text-lg font-semibold">Setting it up</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <strong>Testing:</strong> create a free sandbox account at <span className="font-mono">developer.authorize.net</span> (Sign up →
            Sandbox account). <strong>Going live:</strong> use your merchant account&apos;s Merchant Interface instead.
          </li>
          <li>
            In Authorize.net go to <strong>Account → Settings → Security Settings → API Credentials &amp; Keys</strong>. Copy the{" "}
            <strong>API Login ID</strong>, then create a new <strong>Transaction Key</strong> (creating one disables the old one).
          </li>
          <li>
            On the same Security Settings page open <strong>Manage Public Client Key</strong>, generate one and copy it.
          </li>
          <li>
            Add them in Vercel → Settings → Environment Variables, and in <span className="font-mono">.env.local</span> for local
            testing:
            <pre className="mt-2 overflow-x-auto rounded-md bg-panel p-3 font-mono text-xs">{`NEXT_PUBLIC_AUTHNET_API_LOGIN_ID=…
AUTHNET_TRANSACTION_KEY=…
NEXT_PUBLIC_AUTHNET_CLIENT_KEY=…
AUTHNET_ENV=sandbox        # "production" only for live keys
CRON_SECRET=…              # any long random string`}</pre>
            Use sandbox keys for Preview/Development and live keys only for Production. Redeploy after changing them.
          </li>
          <li>
            For ACH, the live account needs <strong>eCheck.Net</strong> enabled (an application through Authorize.net). Then turn
            methods on or off in Studio → Settings → Payment settings.
          </li>
          <li>Reload this page: every row should be green.</li>
        </ol>
      </section>

      {!live && (
        <section className="card space-y-2 text-sm">
          <h2 className="text-lg font-semibold">Sandbox test details</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Visa <span className="font-mono">4111 1111 1111 1111</span> or <span className="font-mono">4007 0000 0002 7</span>, any future expiry, any CVV.</li>
            <li>Mastercard <span className="font-mono">5424 0000 0000 0015</span> · Amex <span className="font-mono">3700 0000 0000 002</span> · Discover <span className="font-mono">6011 0000 0000 0012</span></li>
            <li>Billing ZIP <span className="font-mono">46282</span> forces a decline, to test the error message.</li>
            <li>eCheck: routing <span className="font-mono">121042882</span>, any account number of 4–17 digits.</li>
          </ul>
        </section>
      )}
    </div>
  );
}
