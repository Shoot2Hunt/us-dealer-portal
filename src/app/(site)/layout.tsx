import type { Metadata } from "next";
import { Barlow_Condensed, Inter, Montserrat, Open_Sans, Oswald, Roboto, Roboto_Slab } from "next/font/google";
import "./globals.css";
import { getPluginSettings, getSiteSettings, getThemeSettings } from "@/sanity/content";
import { themeCss } from "@/lib/theme";
import { SitePlugins } from "@/components/site-plugins";
import { PageViewTracker } from "@/components/page-view-tracker";
import { PluginScripts } from "@/components/plugin-slots";

// Self-hosted by next/font. Every font the theme can pick is declared, but browsers only
// download the ones the page actually uses (Sanity → Appearance → Theme).
const roboto = Roboto({ subsets: ["latin"], variable: "--font-roboto", display: "swap" });
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", display: "swap" });
const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald", display: "swap" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlowCondensed", display: "swap" });
const robotoSlab = Roboto_Slab({ subsets: ["latin"], variable: "--font-robotoSlab", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const openSans = Open_Sans({ subsets: ["latin"], variable: "--font-openSans", display: "swap" });
const fontVars = [roboto, montserrat, oswald, barlowCondensed, robotoSlab, inter, openSans].map((f) => f.variable).join(" ");

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSiteSettings();
  return {
    title: s.portalName ?? "Dealer Portal",
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [theme, plugins] = await Promise.all([getThemeSettings(), getPluginSettings()]);
  const css = themeCss(theme);
  return (
    <html lang="en" className={`${fontVars} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/*
          Theme colors, fonts and corners from Sanity (themeCss only emits validated values).
          `href` + `precedence` let React hoist this into <head> itself. Don't add a manual
          <head> here: it causes a hydration mismatch that drops the site's stylesheet.
        */}
        {css && (
          <style href="portal-theme" precedence="high">
            {css}
          </style>
        )}
        {children}
        <PageViewTracker />
        <PluginScripts scope="all" />
        <SitePlugins analytics={plugins.analytics} consent={plugins.cookieConsent} />
      </body>
    </html>
  );
}
