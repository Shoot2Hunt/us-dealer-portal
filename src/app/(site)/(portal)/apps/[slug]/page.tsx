import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser, isAdmin } from "@/lib/auth/session";
import { getCustomPlugins } from "@/sanity/content";
import { visibleApps } from "@/components/plugin-slots";
import { PluginAppFrame } from "@/components/plugin-app-frame";

export async function generateMetadata({ params }: PageProps<"/apps/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const app = (await getCustomPlugins()).find((p) => p.kind === "app" && p.slug === slug);
  return { title: app?.name ?? "App" };
}

/** A custom app's own page (Studio → Settings → Custom plugins). */
export default async function AppPage({ params }: PageProps<"/apps/[slug]">) {
  const [{ slug }, user] = await Promise.all([params, requireUser()]);
  const app = visibleApps(await getCustomPlugins(), user).find((p) => p.slug === slug && p.showAsPage);
  if (!app) notFound();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{app.name}</h1>
        {app.audience === "admins" && <span className="badge bg-amber-100 text-amber-900">Admins only (testing)</span>}
      </div>
      <PluginAppFrame name={app.name} code={app.code} height={app.height} context={app.shareProfile ? { name: user.name, company: user.company } : null} />
      {isAdmin(user) && (
        <details className="card text-sm">
          <summary className="font-medium">Developer notes (admins only)</summary>
          <div className="mt-3 space-y-2 text-muted">
            <p>
              This app runs in a sealed sandbox: it can run JavaScript, use forms and open links in new tabs, but it can&apos;t read the
              portal&apos;s cookies, sign-in or data, or call the portal&apos;s APIs. Fetching your own public APIs works if they allow
              cross-origin requests (CORS) from any origin.
            </p>
            <p>
              The frame resizes to fit the app automatically. Call <code className="font-mono">window.portal.resize()</code> after
              changing the page if it doesn&apos;t. When &quot;share the viewer&apos;s name and company&quot; is on, they arrive as{" "}
              <code className="font-mono">window.portal.context</code> and a <code className="font-mono">portal:context</code> event.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
