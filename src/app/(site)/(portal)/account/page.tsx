import QRCode from "qrcode";
import { requireSignedIn, twoFactorEnabled, twoFactorSetupRequired } from "@/lib/auth/session";
import { decryptSecret, otpauthUri } from "@/lib/auth/totp";
import { getSiteSettings } from "@/sanity/content";
import { getTierStatus } from "@/lib/tiers";
import { TierProgress } from "@/components/tier-progress";
import { PasswordForm, ProfileForm, SignOutEverywhereButton, TwoFactorPanel } from "./forms";

export const metadata = { title: "Your account" };

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : null;

export default async function AccountPage() {
  const user = await requireSignedIn();
  const isDealer = user.role === "dealer";
  const [s, tier, mustSetUp2fa] = await Promise.all([getSiteSettings(), isDealer ? getTierStatus(user.id) : null, twoFactorSetupRequired(user)]);

  // While setting up 2FA, show the QR code for the pending secret.
  let setup: { qr: string; secret: string } | null = null;
  if (!twoFactorEnabled(user) && user.totpPendingSecret) {
    const secret = decryptSecret(user.totpPendingSecret);
    const uri = otpauthUri(secret, user.email, s.portalName ?? "Dealer Portal");
    setup = { qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }), secret: secret.match(/.{1,4}/g)!.join(" ") };
  }

  const sections = [
    ["profile", "Profile"],
    ["password", "Password"],
    ["two-factor", "Two-step verification"],
    ["sessions", "Signed-in devices"],
  ] as const;

  return (
    <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
        <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm lg:flex-col">
          {sections.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="text-muted hover:text-accent">{label}</a>
          ))}
        </nav>
      </aside>

      <div className="max-w-3xl space-y-8">
        {mustSetUp2fa && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="icon-[lucide--shield-alert] mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Two-step verification is required</p>
              <p className="mt-0.5">
                Your organization requires two-step verification for {isDealer ? "dealer" : "admin"} accounts. Until it&apos;s on, the
                rest of the portal sends you back here. It takes about a minute with an authenticator app (Google Authenticator,
                Microsoft Authenticator, 1Password…).
              </p>
              <a href="#two-factor" className="btn-accent mt-3 inline-flex text-sm">
                <span className="icon-[lucide--shield-check] h-4 w-4" aria-hidden="true" /> Set it up now
              </a>
            </div>
          </div>
        )}
        <section id="profile" className="scroll-mt-24 space-y-4">
          <h2 className="text-lg font-semibold">Profile</h2>
          <div className="card grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Fact label="Email" value={user.email} />
            <Fact label="Account" value={isDealer ? "Dealer" : user.role === "super_admin" ? "Super admin" : "Brand admin"} />
            {isDealer && (
              <>
                <Fact label="Company" value={user.company} />
                <Fact label="FFL" value={user.fflNumber && `${user.fflNumber}${user.fflExpires ? ` · expires ${fmtDate(user.fflExpires)}` : ""}`} />
                <Fact label="SOT" value={user.sotVerified ? `Verified${user.sotExpires ? ` · expires ${fmtDate(user.sotExpires)}` : ""}` : "Not on file"} />
              </>
            )}
            <p className="text-xs text-muted sm:col-span-2">
              To change your email{isDealer && ", company or license details"}, contact us{s.supportEmail && ` at ${s.supportEmail}`}.
            </p>
          </div>
          {tier && <TierProgress status={tier} />}
          <ProfileForm name={user.name} phone={user.phone ?? ""} address={isDealer ? (user.shippingAddress ?? null) : undefined} />
        </section>

        <section id="password" className="scroll-mt-24 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Password</h2>
            <p className="text-sm text-muted">
              {user.passwordChangedAt ? `Last changed ${fmtDate(user.passwordChangedAt)}.` : "Use at least 10 characters."} Changing it signs you out on other devices.
            </p>
          </div>
          <PasswordForm />
        </section>

        <section id="two-factor" className="scroll-mt-24 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Two-step verification</h2>
            <p className="text-sm text-muted">
              Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) when you sign in,
              so a stolen password alone can&apos;t get into your account.
            </p>
          </div>
          <TwoFactorPanel
            enabled={twoFactorEnabled(user)}
            enabledOn={fmtDate(user.totpEnabledAt)}
            codesLeft={user.recoveryCodeHashes?.length ?? 0}
            setup={setup}
          />
        </section>

        <section id="sessions" className="scroll-mt-24 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Signed-in devices</h2>
            <p className="text-sm text-muted">
              Signed in on a shared or lost computer? Sign out everywhere else. You&apos;ll stay signed in here.
            </p>
          </div>
          <div className="card">
            <SignOutEverywhereButton />
          </div>
        </section>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <p>
      <span className="text-muted">{label}: </span>
      <span className="font-medium">{value || "—"}</span>
    </p>
  );
}
