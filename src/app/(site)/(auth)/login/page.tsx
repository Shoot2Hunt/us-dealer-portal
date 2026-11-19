import Link from "next/link";
import { getSiteSettings } from "@/sanity/content";
import { LoginForm } from "./form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const s = await getSiteSettings();
  return (
    <>
      <h1 className="text-lg font-semibold">Dealer sign in</h1>
      {s.loginMessage && <p className="mt-1 text-sm text-muted">{s.loginMessage}</p>}
      <LoginForm next={typeof next === "string" ? next : ""} />
      <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
        Not a dealer yet?{" "}
        <Link href="/request-access" className="font-medium text-accent hover:underline">
          Request access
        </Link>{" "}
        through one of our brands.
      </p>
    </>
  );
}
