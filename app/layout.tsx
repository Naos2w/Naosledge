import type { Metadata } from "next";
import type { ReactNode } from "react";
import Nav from "@/components/nav";
import Footer from "@/components/footer";
import "./globals.css";
import "./glass.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Naosledge — 學到的，慢慢寫下來", template: "%s | Naosledge" },
  description: "一個持續修訂中的公開學習筆記本。記下每天的新知，留給未來的自己。",
  openGraph: { type: "website", locale: "zh_TW", siteName: "Naosledge" },
};
export default function RootLayout({children}: {children:ReactNode}) {
  return <html lang="zh-Hant" data-theme="dark" suppressHydrationWarning><head><meta name="theme-color" content="#080b12"/><script dangerouslySetInnerHTML={{__html: `try { const selected = localStorage.getItem("naosledge-theme") ?? localStorage.getItem("learnlog-theme"); if (selected === "light" || selected === "dark") document.documentElement.dataset.theme = selected; } catch {}`}} /></head><body><div className="site-shell">
    <a className="skip-link" href="#main-content">跳到主要內容</a>
    <Nav/><main id="main-content">{children}</main><Footer/>
  </div></body></html>;
}
