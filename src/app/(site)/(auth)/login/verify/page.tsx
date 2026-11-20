import Link from "next/link";
import { redirect } from "next/navigation";
import { getTwoFactorUser } from "@/lib/auth/session";
import { VerifyForm } from "./form";

export default async function VerifyLoginPage() {
  const pending = await getTwoFactorUser();
  if (!pending) redirect("/login");
  return (
    <>
      <h1 className="text-lg font-semibold">Two-step verification</h1>
      <p className="mt-1 text-sm text-muted">
        Open your authenticator app and enter the 6-digit code for <span className="font-medium text-ink">{pending.user.email}</span>.
      </p>
      <VerifyForm />
      <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
        Lost your phone? Enter one of your recovery codes instead. No codes left? Contact us to turn off two-step verification.{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">Start over</Link>
      </p>
    </>
  );
}
