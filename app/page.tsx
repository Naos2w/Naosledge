import Link from "next/link";
import { ArrowRight, ArrowUpRight, Search, X } from "lucide-react";
import PostCard from "@/components/post-card";
import { formatDate, todayTaipei } from "@/lib/format";
import { publishedPosts } from "@/lib/posts";

export const dynamic = "force-dynamic";
type Params = {q?:string;tag?:string};
export default async function Home({searchParams}: {searchParams:Promise<Params>}) {
  const {q="", tag=""} = await searchParams;
  const query = q.trim().toLocaleLowerCase().slice(0,80);
  const selectedTag = tag.trim().slice(0,36);
  const all = await publishedPosts();
  const tags = [...new Set(all.flatMap((p)=>p.tags))].slice(0,20);
  const filtered = all.filter((p) =>
    (!selectedTag || p.tags.includes(selectedTag)) &&
    (!query || [p.title,p.excerpt,p.content_md,p.category,...p.tags].join(" ").toLocaleLowerCase().includes(query))
  );
  const activity = new Map<string,number>();
  all.forEach((p)=>activity.set(p.learned_on,(activity.get(p.learned_on)??0)+1));
  const anchor = new Date(`${todayTaipei()}T12:00:00Z`);
  const days = Array.from({length:35},(_,i)=>{
    const date = new Date(anchor); date.setUTCDate(date.getUTCDate()-(34-i));
    const key = date.toISOString().slice(0,10);
    return {date:key,count:activity.get(key)??0};
  });
  const recent = [...all].sort((a,b)=>b.learned_on.localeCompare(a.learned_on)).slice(0,4);
  return <>
    <section className="editorial-hero container" aria-labelledby="hero-title">
      <div className="hero-main">
        <div className="overline"><span className="tiny-square"/> AN OPEN NOTEBOOK <span className="overline-line"/> EST. 2026</div>
        <h1 id="hero-title">學到的，<br/><span>慢慢寫下來。</span></h1>
        <p className="hero-subtitle">學習不只有答案，也有那些想通的瞬間。<br/>這裡記錄每天遇見的新知，以及我如何重新理解它們。</p>
        <div className="hero-actions"><a className="button-primary" href="#archive">閱讀筆記 <ArrowRight size={17}/></a><Link href="/about" className="text-link">這個筆記本的由來 <ArrowUpRight size={16}/></Link></div>
      </div>
      <aside className="hero-margin" aria-label="最近更新">
        <div className="margin-head"><span>THE MARGIN</span><span>01 — ∞</span></div>
        <div className="margin-symbol" aria-hidden="true"><span>知</span><span className="symbol-accent">·</span></div>
        <div className="margin-summary"><span className="margin-caption">LATEST ENTRY / 最近更新</span>
          {all[0] ? <Link href={`/notes/${all[0].slug}`}><strong>{all[0].title}</strong><span>{formatDate(all[0].updated_at)} <ArrowUpRight size={14}/></span></Link> : <p>第一篇筆記，正在路上。</p>}
        </div>
        <div className="margin-foot"><span>{String(all.length).padStart(2,"0")} ENTRIES</span><span>CURIOUS, ALWAYS.</span></div>
      </aside>
    </section>
    <section className="archive-section container" id="archive" aria-labelledby="archive-heading">
      <div className="section-line"/>
      <div className="section-header"><div><div className="section-kicker">01 / THE ARCHIVE</div><h2 id="archive-heading">文章索引<span className="title-period">.</span></h2></div><p>依最近更新排序 · 共 {all.length} 篇公開筆記</p></div>
      <div className="archive-toolbar"><form action="/" className="search-form"><Search size={18} aria-hidden="true"/><label className="visually-hidden" htmlFor="search-posts">搜尋筆記</label><input id="search-posts" name="q" defaultValue={q.slice(0,80)} placeholder="搜尋筆記、概念或關鍵字…"/><button type="submit">搜尋 <ArrowRight size={16}/></button></form>
        <div className="filter-chips" aria-label="依標籤篩選"><Link className={!selectedTag?"chip active":"chip"} href={query?`/?q=${encodeURIComponent(q)}`:"/"}>全部</Link>{tags.map((t)=><Link className={selectedTag===t?"chip active":"chip"} key={t} href={`/?tag=${encodeURIComponent(t)}${q?`&q=${encodeURIComponent(q)}`:""}`}>{t}</Link>)}</div></div>
      <div className="archive-list-head"><span>INDEX / {String(filtered.length).padStart(2,"0")}</span>{(query||selectedTag)?<Link href="/">清除篩選 <X size={13}/></Link>:<span>READ & REVISIT</span>}</div>
      {filtered.length?<div className="posts-list">{filtered.map((post,index)=><PostCard key={post.id} post={post} index={index}/>)}</div>
        :<div className="empty-state"><span className="empty-index">∅</span><h3>{all.length?"找不到符合條件的筆記":"還沒有公開筆記"}</h3><p>{all.length?"可以換個關鍵字，或清除目前的篩選條件。":"寫下第一則筆記後，就會出現在這裡。"}</p><Link href={all.length?"/":"/about"} className="text-link">{all.length?"查看所有筆記":"關於 Naosledge"} <ArrowRight size={16}/></Link></div>}
    </section>
    <section className="trail-section container" id="timeline" aria-labelledby="trail-heading"><div className="section-line"/>
      <div className="section-header"><div><div className="section-kicker">02 / DAY BY DAY</div><h2 id="trail-heading">學習足跡<span className="title-period">.</span></h2></div><p>把零散的日子，慢慢連成線。</p></div>
      <div className="trail-layout"><div className="trail-calendar"><div className="trail-subhead"><strong>最近 35 天</strong><span>LEARNING FREQUENCY</span></div>
        <div className="heatmap-grid" role="img" aria-label="最近 35 天公開筆記活動日曆">{days.map(({date,count})=><span key={date} className={`heat-cell heat-level-${Math.min(count,3)}`} title={`${date}：${count} 篇公開筆記`}/>)}</div>
        <div className="trail-legend"><span>{formatDate(days[0].date)} — {formatDate(days[34].date)}</span><span className="legend-scale">少 <i className="heat-level-0"/><i className="heat-level-1"/><i className="heat-level-2"/><i className="heat-level-3"/> 多</span></div></div>
        <div className="trail-recent"><div className="trail-subhead"><strong>依學習日期回顧</strong><span>RECENTLY LEARNED</span></div>
          {recent.length?recent.map((p)=><Link href={`/notes/${p.slug}`} className="timeline-row" key={p.id}><time>{formatDate(p.learned_on,false)}</time><span>{p.title}</span><ArrowUpRight size={16}/></Link>):<p className="timeline-empty">還沒有學習紀錄。</p>}
        </div></div>
    </section>
    <section className="colophon container"><span className="colophon-mark">※</span><p>記下來，是為了以後<br/>能看見自己走過的路。</p><span>NOTES FOR THE DAYS AHEAD.</span></section>
  </>;
}
