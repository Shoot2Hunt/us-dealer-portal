"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Helper injected into every app: reports the app's height so the frame fits it, and
 * receives the optional viewer profile as `window.portal.context` + a "portal:context" event.
 */
const BRIDGE = `<script>(function(){
  var last = 0;
  function post(){ var h = Math.ceil(document.documentElement.scrollHeight); if (h !== last) { last = h; parent.postMessage({ type: "portal:resize", height: h }, "*"); } }
  addEventListener("load", post);
  if (window.ResizeObserver) new ResizeObserver(post).observe(document.documentElement); else setInterval(post, 500);
  window.portal = { resize: post, context: null };
  addEventListener("message", function (e) {
    if (e.source === parent && e.data && e.data.type === "portal:context") {
      window.portal.context = e.data.context;
      dispatchEvent(new CustomEvent("portal:context", { detail: e.data.context }));
    }
  });
})();</script>`;

function withBridge(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${BRIDGE}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${BRIDGE}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${BRIDGE}</head><body>${html}</body></html>`;
}

/**
 * Runs an admin-uploaded app in a sealed sandbox. Without `allow-same-origin` the app gets
 * an opaque origin: it can't read the portal's cookies or storage, call its APIs as the
 * viewer, or navigate the page. It can run scripts, use forms, and open links in new tabs.
 */
export function PluginAppFrame({
  name,
  code,
  height,
  context,
}: {
  name: string;
  code: string;
  height: number;
  /** Shared only when the plugin's "share profile" option is on. */
  context?: { name: string; company: string | null } | null;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(height);
  const srcDoc = useMemo(() => withBridge(code), [code]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only messages from this frame, with a sane height.
      if (e.source !== ref.current?.contentWindow) return;
      const d = e.data as { type?: string; height?: unknown };
      if (d?.type === "portal:resize" && typeof d.height === "number" && Number.isFinite(d.height)) {
        setH(Math.min(6000, Math.max(80, Math.round(d.height))));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const sendContext = () => {
    if (context) ref.current?.contentWindow?.postMessage({ type: "portal:context", context }, "*");
  };

  return (
    <iframe
      ref={ref}
      title={name}
      srcDoc={srcDoc}
      onLoad={sendContext}
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{ height: h }}
      className="w-full rounded-lg border border-line bg-white transition-[height] duration-200"
    />
  );
}
