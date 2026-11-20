import Link from "next/link";
import { ForgotPasswordForm } from "./form";

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-lg font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-muted">Enter the email you sign in with and we&apos;ll send you a link to choose a new password.</p>
      <ForgotPasswordForm />
      <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
        Remembered it? <Link href="/login" className="font-medium text-accent hover:underline">Sign in</Link>
      </p>
    </>
  );
}
