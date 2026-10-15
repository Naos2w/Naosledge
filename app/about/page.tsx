import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { getPublicSiteOrigin } from "@/lib/seo";

const origin = getPublicSiteOrigin();
export const metadata: Metadata = {
  title: "關於這裡",
  alternates: origin ? {canonical: `${origin}/about`} : undefined,
  openGraph: {
    title: "關於 Naosledge",
    description: "為什麼開始記錄每天學到的事情，以及這本公開筆記想留下什麼。",
    ...(origin ? {url: `${origin}/about`} : {}),
  },
};
export default function About() {
  return <section className="about-page container"><Link href="/" className="back-link"><ArrowLeft size={16}/> 返回首頁</Link>
    <div className="about-layout"><div className="about-sidebar"><span>AN OPEN NOTEBOOK</span><strong>ABOUT<br/>NAOSLEDGE.</strong><span>01 / 03</span></div>
    <div className="about-content"><span className="section-kicker">關於這本筆記</span><h1>把理解留在<br/>時間裡。</h1>
      <p className="about-lead">Naosledge 是我的公開學習筆記本。這裡沒有完美的標準答案，只有每個當下真正理解的事情。</p>
      <div className="about-chapter"><span>01</span><div><h2>先記下來</h2><p>一個概念、一段程式碼，或是突然想通的問題，都值得被留下。</p></div></div>
      <div className="about-chapter"><span>02</span><div><h2>慢慢整理</h2><p>筆記可以反覆補充、修正。今天寫下的理解，明天可能會有更好的版本。</p></div></div>
      <div className="about-chapter"><span>03</span><div><h2>公開分享</h2><p>如果這些學習紀錄剛好也能幫上其他人，那就再好不過了。</p></div></div>
      <Link href="/#archive" className="button-primary">回到文章索引 <ArrowUpRight size={17}/></Link>
    </div></div>
  </section>;
}
