import type { User } from "@/lib/db";
import { isAdmin } from "@/lib/auth/session";
import { getCustomPlugins, type CustomPlugin } from "@/sanity/content";
import { PluginAppFrame } from "./plugin-app-frame";

/** Apps this user may see (admin-only apps are for testing before going live). */
export function visibleApps(plugins: CustomPlugin[], user: User | null) {
  return plugins.filter((p) => p.kind === "app" && (p.audience === "all" || (user && isAdmin(user))));
}

/** Embedded apps for a spot on a portal page ("inventory" or "product"). */
export async function PluginEmbeds({ slot, user }: { slot: "inventory" | "product"; user: User }) {
  const apps = visibleApps(await getCustomPlugins(), user).filter((p) => p.embeds.includes(slot));
  if (!apps.length) return null;
  return (
    <div className="space-y-4">
      {apps.map((p) => (
        <PluginAppFrame key={p.id} name={p.name} code={p.code} height={p.height} context={p.shareProfile ? { name: user.name, company: user.company } : null} />
      ))}
    </div>
  );
}

/**
 * Site scripts for a scope, rendered into the page's HTML so they run on load. Only plugins
 * whose admin ticked "I understand this runs with full access" ever reach this point.
 */
export async function PluginScripts({ scope }: { scope: "portal" | "all" }) {
  const scripts = (await getCustomPlugins()).filter((p) => p.kind === "script" && p.scriptScope === scope);
  if (!scripts.length) return null;
  return (
    <>
      {scripts.map((p) => (
        <div key={p.id} data-plugin={p.name} dangerouslySetInnerHTML={{ __html: p.code }} />
      ))}
    </>
  );
}
