"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useState } from "react";
import type { PluginSettings } from "@/sanity/content";

const CONSENT_KEY = "dp-cookie-consent";
type Consent = "granted" | "denied" | null;

function readConsent(): Consent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Plugins switched on in Sanity → Plugins: analytics/tracking tags and the cookie banner.
 * IDs were format-checked on the server and are JSON-encoded here, so nothing from
 * Studio can become arbitrary script.
 */
export function SitePlugins({ analytics, consent }: { analytics: PluginSettings["analytics"]; consent: PluginSettings["cookieConsent"] }) {
  const [choice, setChoice] = useState<Consent>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved choice once, after hydration
    setChoice(readConsent());
    setReady(true);
  }, []);

  const decide = (c: "granted" | "denied") => {
    try {
      localStorage.setItem(CONSENT_KEY, c);
    } catch {}
    setChoice(c);
  };

  const hasTracking = analytics.enabled && Boolean(analytics.ga4Id || analytics.gtmId || analytics.metaPixelId);
  const trackingAllowed = hasTracking && (!consent.enabled || choice === "granted");
  const showBanner = ready && consent.enabled && choice === null;

  return (
    <>
      {trackingAllowed && <TrackingTags {...analytics} />}
      {showBanner && (
        <div
          role="dialog"
          aria-live="polite"
          aria-label="Cookie consent"
          className="fixed inset-x-3 bottom-3 z-[60] mx-auto flex max-w-3xl animate-fade-up flex-col gap-3 rounded-xl border border-white/10 bg-ink/95 p-4 text-sm text-white shadow-2xl backdrop-blur sm:flex-row sm:items-center"
        >
          <span className="icon-[lucide--cookie] hidden h-6 w-6 shrink-0 text-accent-light sm:block" aria-hidden="true" />
          <p className="flex-1 text-white/85">
            {consent.message}{" "}
            {consent.showPrivacyLink && (
              <Link href="/legal/privacy-policy" className="whitespace-nowrap text-accent-light underline underline-offset-2 hover:text-white">
                Privacy Policy
              </Link>
            )}
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => decide("denied")} className="rounded-md px-3 py-2 text-white/75 ring-1 ring-white/20 transition hover:bg-white/10 hover:text-white">
              {consent.declineLabel}
            </button>
            <button type="button" onClick={() => decide("granted")} className="btn-accent">
              {consent.acceptLabel}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function TrackingTags({ ga4Id, gtmId, metaPixelId }: PluginSettings["analytics"]) {
  const js = JSON.stringify;
  return (
    <>
      {ga4Id && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`} strategy="afterInteractive" />
          <Script id="plugin-ga4" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${js(ga4Id)});`}
          </Script>
        </>
      )}
      {gtmId && (
        <Script id="plugin-gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${js(gtmId)});`}
        </Script>
      )}
      {metaPixelId && (
        <Script id="plugin-meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${js(metaPixelId)});fbq('track','PageView');`}
        </Script>
      )}
    </>
  );
}
