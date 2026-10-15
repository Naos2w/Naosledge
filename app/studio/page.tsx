import Link from "next/link";
import { ArrowUpRight, LogOut, Plus, PenLine } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { signOut } from "@/app/actions";
import type { Post } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = {title:"管理工作室",robots:{index:false,follow:false}};
export default async function Studio() {
  const {supabase,user} = await requireAdmin();
  const {data,error}= await supabase.from("posts").select("*").order("updated_at",{ascending:false}).limit(300);
  if (error) throw new Error(`無法讀取後台文章：${error.message}`);
  const posts=(data||[]) as Post[];
  const published=posts.filter(p=>p.status==="published");
  return <section className="studio-page container">
    <div className="studio-topline"><span className="section-kicker">PRIVATE WRITING DESK / 管理工作室</span><form action={signOut}><button className="studio-signout" type="submit"><LogOut size={14}/> 登出</button></form></div>
    <div className="studio-hero"><div><h1>繼續寫，<br/>繼續理解<span className="title-period">.</span></h1><p>每篇文章都可以回來修改。先記下來，再慢慢寫好。</p></div><Link href="/studio/new" className="button-primary"><Plus size={18}/> 新增筆記</Link></div>
    <div className="studio-metrics" aria-label="筆記概況"><div><span>全部文章</span><strong>{posts.length.toString().padStart(2,"0")}</strong></div><div><span>已公開</span><strong>{published.length.toString().padStart(2,"0")}</strong></div><div><span>未完成草稿</span><strong>{(posts.length-published.length).toString().padStart(2,"0")}</strong></div></div>
    <div className="studio-list-heading"><div><span className="section-kicker">MANAGE ENTRIES</span><h2>我的筆記</h2></div><span className="studio-identity">{user.email}</span></div>
    <div className="studio-list"><div className="studio-list-labels"><span>ARTICLE</span><span>VISIBILITY</span></div>
      {posts.length?posts.map((p,index)=><div className="studio-list-row" key={p.id}><span className="studio-row-num">{String(index+1).padStart(2,"0")}</span>
        <div className="studio-list-main"><Link href={`/studio/${p.id}`}>{p.title}</Link><span>{formatDate(p.learned_on)} · {p.category} · 更新 {formatDate(p.updated_at)}</span></div>
        <span className={p.status==="published"?"status-pill published":"status-pill draft"}>{p.status==="published"?"公開":"草稿"}</span>
        <div className="studio-row-actions">{p.status==="published"&&<Link href={`/notes/${p.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`檢視 ${p.title}`}><ArrowUpRight size={17}/></Link>}<Link href={`/studio/${p.id}`} aria-label={`編輯 ${p.title}`}><PenLine size={17}/></Link></div>
      </div>):<div className="studio-empty"><h3>空白頁，從這裡開始。</h3><p>寫下今天第一件想留下來的事。</p><Link className="button-primary" href="/studio/new"><Plus size={17}/> 新增第一篇</Link></div>}
    </div>
  </section>;
}
