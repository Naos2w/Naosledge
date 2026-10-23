import Link from "next/link";
import {BookOpen,Search,Plus,ArrowRight,LockKeyhole,Network,GitCompareArrows} from "lucide-react";
import {requireVault,searchVaultNotes} from "@/lib/vault-server";
import {normalizedQueryParam} from "@/lib/search-params";
import {formatDate} from "@/lib/format";
import {privateVaultPreviewIntent} from "@/lib/neon/vault-preview";

export const dynamic="force-dynamic";
export const metadata={title:"私人知識庫",robots:{index:false,follow:false}};

export default async function VaultHome({searchParams}:{
  searchParams:Promise<{q?:string|string[]}>;
}) {
  const ctx=await requireVault();
  const {q}=await searchParams;
  const query=normalizedQueryParam(q,120);
  let notes:Awaited<ReturnType<typeof searchVaultNotes>>=[];
  let unavailable=false;
  try { notes=await searchVaultNotes(ctx,query); }
  catch {unavailable=true;}
  return <section className="vault-root container">
    <div className="vault-topline"><span className="section-kicker">PRIVATE VAULT / SECOND BRAIN</span>
      <span className="vault-privacy"><LockKeyhole size={14}/> 僅限本人可見</span></div>
    <div className="vault-heading"><div><h1>我的知識庫<span className="title-period">.</span></h1>
      <p>把零散的知識連起來。預設私人保存，只有經過獨立審核的副本才能公開。</p></div>
      <Link className="button-primary" href="/vault/new"><Plus size={17}/> 新增私人筆記</Link>
    </div>
    <div className="vault-nav">{!privateVaultPreviewIntent(process.env)&&
      <Link href="/studio">公開文章工作室 <ArrowRight size={14}/></Link>}
      <Link href="/vault/graph" className="vault-graph-entry"><Network size={16}/> 知識網絡圖 <ArrowRight size={14}/></Link>
      <Link href="/vault/sync" className="vault-graph-entry"><GitCompareArrows size={16}/> 同步審查預演 <ArrowRight size={14}/></Link></div>
    <form action="/vault" className="vault-search" role="search">
      <Search size={18}/><label htmlFor="vault-query" className="visually-hidden">搜尋私人知識</label>
      <input id="vault-query" name="q" maxLength={120} defaultValue={query}
        placeholder="搜尋標題、正文、標籤、中文概念…"/>
      <button type="submit">搜尋</button>
    </form>
    {unavailable ? <div className="vault-notice" role="status">
      <strong>Private Vault 尚未啟用線上資料庫。</strong>
      <p>第二大腦的 Migration 尚未套用到獲核准的環境，原有公開網站與文章不受影響。</p>
    </div> : <>
      <div className="vault-list-heading"><h2>{query?"搜尋結果":"最近的私人筆記"}</h2>
        <span>{query?"依符合程度排序 · ":""}本次顯示 {notes.length} 篇，最多 100 篇</span></div>
      <div className="vault-list">
        {notes.length?notes.map(n=><Link href={`/vault/${n.id}`} key={n.id}
          className="vault-list-item"><div>
            <span className="vault-item-category">{n.category} · {formatDate(n.learned_on)}</span>
            <h3>{n.title}</h3><p>{n.summary||"尚未填寫摘要"}</p>
            <div className="vault-item-tags">{n.tags.map(t=><span key={t}>#{t}</span>)}</div>
          </div><ArrowRight size={17}/></Link>):<div className="vault-empty">
          <BookOpen size={28}/><h3>{query?"沒有符合的私人筆記":"你的知識網絡，從第一篇開始。"}</h3>
          <p>{query?"試試另一個關鍵字，或清除搜尋條件。":"可以先記下簡短觀念，再用 [[知識名稱]] 慢慢建立關聯。"}</p>
          <Link href={query?"/vault":"/vault/new"} className="text-link">{query?"清除搜尋":"新增第一篇私人筆記"}</Link>
        </div>}
      </div>
    </>}
  </section>;
}
