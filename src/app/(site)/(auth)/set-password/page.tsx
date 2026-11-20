import Link from "next/link";
import { SetPasswordForm } from "./form";

export default async function SetPasswordPage({ searchParams }: PageProps<"/set-password">) {
  const { token, reset } = await searchParams;
  if (typeof token !== "string" || !token) {
    return (
      <p className="text-sm">
        This link is missing its token. Use the link from your email, or{" "}
        <Link href="/forgot-password" className="font-medium text-accent hover:underline">request a new one</Link>.
      </p>
    );
  }
  const isReset = reset === "1";
  return (
    <>
      <h1 className="text-lg font-semibold">{isReset ? "Choose a new password" : "Set your password"}</h1>
      <p className="mt-1 text-sm text-muted">
        {isReset ? "Pick a new password for your dealer account." : "Your dealer account is approved. Choose a password to sign in."}
      </p>
      <SetPasswordForm token={token} />
    </>
  );
}
