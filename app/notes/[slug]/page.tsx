import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Markdown from "@/components/markdown";
import { formatDate, readingMinutes } from "@/lib/format";
import { publishedPost } from "@/lib/posts";
import { articleCanonical, articleStructuredData, getPublicSiteOrigin, safeJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";
type Props = {params:Promise<{slug:string}>};
export async function generateMetadata({params}:Props): Promise<Metadata> {
  const {slug} = await params;
  const p = await publishedPost(slug);
  if (!p) return {title: "找不到文章", robots: {index: false, follow: false}};

  const origin = getPublicSiteOrigin();
  const canonical = origin ? articleCanonical(p.slug, origin) : undefined;
  const description = p.excerpt || `${p.title} - Naosledge`;
  return {
    title: p.title,
    description,
    alternates: canonical ? {canonical} : undefined,
    openGraph: {
      type: "article", title: p.title, description,
      publishedTime: p.published_at || undefined,
      modifiedTime: p.updated_at, tags: p.tags,
      ...(canonical ? {url: canonical} : {}),
    },
    twitter: {card: "summary", title: p.title, description},
  };
}
export default async function Article({params}:Props) {
  const {slug} = await params;
  const p = await publishedPost(slug);
  if (!p) notFound();
  const origin = getPublicSiteOrigin();
  return <article className="article-page container" aria-labelledby="article-title">
    {origin && <script type="application/ld+json" dangerouslySetInnerHTML={{
      __html: safeJsonLd(articleStructuredData(p, origin)),
    }}/>}
    <div className="article-top"><Link href="/#archive" className="back-link"><ArrowLeft size={16}/> 返回文章索引</Link><span>NAOSLEDGE / FIELD NOTE</span></div>
    <header className="article-header"><span className="section-kicker">{p.category || "未分類"} / {formatDate(p.learned_on)}</span><h1 id="article-title">{p.title}</h1>{p.excerpt&&<p className="article-deck">{p.excerpt}</p>}</header>
    <div className="article-rule"/>
    <div className="article-layout"><aside className="article-aside"><span className="side-label">ABOUT THIS NOTE</span><dl><div><dt>學習日期</dt><dd>{formatDate(p.learned_on)}</dd></div><div><dt>最後更新</dt><dd>{formatDate(p.updated_at)}</dd></div><div><dt>閱讀時間</dt><dd>約 {readingMinutes(p.content_md)} 分鐘</dd></div></dl><span className="side-label">TOPICS</span><div className="article-tags">{p.tags.map((tag)=><Link key={tag} href={`/?tag=${encodeURIComponent(tag)}`}>#{tag}</Link>)}</div></aside>
      <div className="article-content"><Markdown content={p.content_md}/></div></div>
    <div className="article-bottom"><Link href="/#archive" className="back-link"><ArrowLeft size={17}/> 所有學習筆記</Link><span>KEEP LEARNING <ArrowUpRight size={15}/></span></div>
  </article>;
}
