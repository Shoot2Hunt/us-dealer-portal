import type { Metadata } from "next";
import "./globals.css";
import { getSiteSettings } from "@/sanity/content";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSiteSettings();
  return {
    title: s.portalName ?? "Dealer Portal",
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
