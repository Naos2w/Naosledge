import type { Metadata } from "next";
import type { ReactNode } from "react";
import Nav from "@/components/nav";
import Footer from "@/components/footer";
import { getPublicSiteOrigin } from "@/lib/seo";
import "./globals.css";
import "./glass.css";

const publicOrigin = getPublicSiteOrigin();
const description = "一個持續修訂中的公開學習筆記本。記下每天的新知，留給未來的自己。";
export const metadata: Metadata = {
  // Next.js needs a metadataBase even in isolated builds. Never expose this
  // development fallback through canonical links or a public sitemap.
  metadataBase: new URL(publicOrigin ?? "http://localhost:3000"),
  title: { default: "Naosledge — 學到的，慢慢寫下來", template: "%s | Naosledge" },
  description,
  alternates: publicOrigin ? { canonical: publicOrigin } : undefined,
  robots: publicOrigin ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: {
    type: "website", locale: "zh_TW", siteName: "Naosledge",
    title: "Naosledge — 學到的，慢慢寫下來", description,
    ...(publicOrigin ? { url: publicOrigin } : {}),
  },
  twitter: { card: "summary", title: "Naosledge — 學到的，慢慢寫下來", description },
};
export default function RootLayout({children}: {children:ReactNode}) {
  return <html lang="zh-Hant" data-theme="dark" suppressHydrationWarning><head><meta name="theme-color" content="#080b12"/><script dangerouslySetInnerHTML={{__html: `try { const selected = localStorage.getItem("naosledge-theme") ?? localStorage.getItem("learnlog-theme"); if (selected === "light" || selected === "dark") document.documentElement.dataset.theme = selected; } catch {}`}} /></head><body><div className="site-shell">
    <a className="skip-link" href="#main-content">跳到主要內容</a>
    <Nav/><main id="main-content">{children}</main><Footer/>
  </div></body></html>;
}
