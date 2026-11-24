import Link from "next/link";
import { cookies } from "next/headers";
import { getBrands, getSiteSettings } from "@/sanity/content";
import { STORES } from "@/lib/woo/stores";
import { RequestAccessForm } from "./form";
import { DRAFT_COOKIE, parseDraft } from "./draft";

export default async function RequestAccessPage() {
  const [s, brands, jar] = await Promise.all([getSiteSettings(), getBrands(), cookies()]);
  // This browser's own saved draft, if any (a session cookie only this page receives).
  const draft = parseDraft(jar.get(DRAFT_COOKIE)?.value);
  const options = brands.length
    ? brands.filter((b) => b.active).map((b) => ({ value: b.storeKey, label: b.name }))
    : STORES.map((st) => ({ value: st.key, label: st.name }));
  return (
    <>
      <h1 className="text-lg font-semibold">Request dealer access</h1>
      <p className="mt-1 text-sm text-muted">
        {s.requestAccessIntro ??
          "Choose the brand you work with. Their team will verify your license and email you a link to set your password."}
      </p>
      <RequestAccessForm brands={options} initialDraft={draft} />
      <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
        Already approved? <Link href="/login" className="font-medium text-accent hover:underline">Sign in</Link>
      </p>
    </>
  );
}
