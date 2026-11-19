import { SetPasswordForm } from "./form";

export default async function SetPasswordPage({ searchParams }: PageProps<"/set-password">) {
  const { token } = await searchParams;
  if (typeof token !== "string" || !token) {
    return <p className="text-sm">This link is missing its token. Use the link from your approval email.</p>;
  }
  return (
    <>
      <h1 className="text-lg font-semibold">Set your password</h1>
      <p className="mt-1 text-sm text-muted">Your dealer account is approved. Choose a password to sign in.</p>
      <SetPasswordForm token={token} />
    </>
  );
}
