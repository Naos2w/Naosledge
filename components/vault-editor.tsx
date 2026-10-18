"use client";

import {useRef,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {
  ArrowLeft,ArrowRight,BookLock,Check,Download,Eye,FilePenLine,
  Link2,Save,ShieldCheck,Trash2,Upload,Globe2,Network,
} from "lucide-react";
import Markdown from "@/components/markdown";
import {saveVaultNote,deleteVaultNote,createVaultPublicDraft} from "@/app/vault/actions";
import {parseMarkdownBackup,serializeMarkdownBackup,markdownBackupFilename} from "@/lib/markdown-backup";
import {parseObsidianMarkdown,serializeObsidianMarkdown} from "@/lib/obsidian-markdown";
import {slugify,todayTaipei} from "@/lib/format";
import type {KnowledgeTitle} from "@/lib/wiki-links";
import type {VaultNote,VaultRelation} from "@/lib/vault-server";
import type {VaultNoteInput} from "@/lib/vault-validation";

export default function VaultEditor({initial,targets,wikiTargets,relations,allowPublication=true}:{
  initial?:VaultNote;targets:KnowledgeTitle[];allowPublication?:boolean;
  wikiTargets:Record<string,string>;
  relations?:{outgoing:VaultRelation[];backlinks:VaultRelation[];unresolved:string[]};
}) {
  const router=useRouter();
  const [title,setTitle]=useState(initial?.title||"");
  const [slug,setSlug]=useState(initial?.slug||"");
  const [summary,setSummary]=useState(initial?.summary||"");
  const [content,setContent]=useState(initial?.content_md||"");
  const [category,setCategory]=useState(initial?.category||"筆記");
  const [tagsText,setTagsText]=useState(initial?.tags.join(", ")||"");
  const [learnedOn,setLearnedOn]=useState(initial?.learned_on||todayTaipei());
  const [targetSlug,setTargetSlug]=useState("");
  const [preview,setPreview]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const manualSlug=useRef(Boolean(initial));
  const editor=useRef<HTMLTextAreaElement>(null);
  const backupFile=useRef<HTMLInputElement>(null);
  const dirty=Boolean(initial) && (
    title!==initial?.title || slug!==initial?.slug ||
    summary!==initial?.summary || content!==initial?.content_md ||
    category!==initial?.category || tagsText!==initial?.tags.join(", ") ||
    learnedOn!==initial?.learned_on
  );

  function updateTitle(value:string) {
    setTitle(value);
    if(!manualSlug.current && !initial) {
      const suggested=slugify(value);
      setSlug(suggested.length>=3 ? suggested.slice(0,120) :
        `knowledge-${todayTaipei().replaceAll("-","")}-${Math.random().toString(36).slice(2,8)}`);
    }
  }

  function insertLink() {
    const slug=targetSlug.trim();
    if(!slug) {setError("請先選擇要連結的私人筆記。");return;}
    const textarea=editor.current;
    const start=textarea?.selectionStart??content.length;
    const end=textarea?.selectionEnd??content.length;
    const selected=content.slice(start,end).trim();
    const insert=`[[${slug}${selected?"|"+selected:""}]]`;
    if(content.length+insert.length>200000) {
      setError("Markdown 已達 200,000 字上限。");return;
    }
    setContent(content.slice(0,start)+insert+content.slice(end));
    setError("");
    requestAnimationFrame(()=>{
      textarea?.focus();
      textarea?.setSelectionRange(start+insert.length,start+insert.length);
    });
  }

  function currentMarkdownDraft() {
    return {
      title,slug,excerpt:summary,category,learned_on:learnedOn,
      tags:tagsText.split(/[,，\n]/g).map(s=>s.trim()).filter(Boolean),
      content_md:content,
    };
  }

  function downloadMarkdown(body:string,message:string) {
    const url=URL.createObjectURL(new Blob([body],{type:"text/markdown;charset=utf-8"}));
    const element=document.createElement("a");
    element.href=url;
    element.download=markdownBackupFilename(title,slug);
    document.body.appendChild(element);element.click();element.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1500);
    setNotice(message);
  }

  function downloadBackup() {
    downloadMarkdown(serializeMarkdownBackup(currentMarkdownDraft()),
      "已下載 Markdown 備份，僅保存在你選擇的裝置位置。");
  }

  function downloadObsidian() {
    downloadMarkdown(serializeObsidianMarkdown(currentMarkdownDraft()),
      "已下載 Obsidian 相容的 .md；可手動放入你的 Obsidian Vault，不會自動同步。");
  }

  async function importBackup(file?:File) {
    if(!file) return;
    if(file.size>1_000_000) {setError("匯入檔不得超過 1 MB。");return;}
    try {
      const text=await file.text();
      const obsidian=parseObsidianMarkdown(text,file.name,todayTaipei());
      const parsed=obsidian??parseMarkdownBackup(text);
      if(!window.confirm("匯入會覆蓋目前尚未儲存的編輯內容，但不會直接公開。確定繼續嗎？")) return;
      setContent(parsed.content_md);
      if(parsed.metadata) {
        setTitle(parsed.metadata.title);
        setSlug(parsed.metadata.slug);
        setSummary(parsed.metadata.excerpt);
        setCategory(parsed.metadata.category);
        setTagsText(parsed.metadata.tags.join(", "));
        setLearnedOn(parsed.metadata.learned_on);
        manualSlug.current=true;
      }
      setError("");
      setNotice(obsidian
        ?"Obsidian 筆記與屬性已載入，尚未儲存到私人知識庫。"
        :"Markdown 已載入編輯器，尚未儲存到私人知識庫。");
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"無法匯入 Markdown。");
    }
  }

  async function save() {
    if(busy) return;
    const payload:VaultNoteInput={
      id:initial?.id,title,slug,summary,content_md:content,category,
      tags:tagsText.split(/[,，\n]/g).map(x=>x.trim()).filter(Boolean),
      learned_on:learnedOn,
    };
    setBusy(true);setError("");setNotice("");
    try {
      const result=await saveVaultNote(payload);
      if(!result.ok) {setError(result.error);return;}
      setNotice("私人筆記與知識連結已儲存。");
      router.replace(`/vault/${result.id}`);
      router.refresh();
    } catch {
      setError("儲存時發生問題，請保持頁面並重試。");
    } finally {setBusy(false);}
  }

  async function remove() {
    if(!initial || !window.confirm("確定刪除這篇私人筆記？此操作無法復原，獨立的公開草稿或文章不會自動刪除。")) return;
    setBusy(true);setError("");
    try {
      const result=await deleteVaultNote(initial.id);
      if(!result.ok) {setError(result.error||"刪除失敗");return;}
      router.replace("/vault");router.refresh();
    } catch {setError("刪除失敗，請稍後再試。");}
    finally {setBusy(false);}
  }

  async function createPublicDraft() {
    if(!initial || dirty || busy) return;
    const candidate=`${initial.slug}-public`.slice(0,120).replace(/-$/,"");
    const suggested=window.prompt("輸入公開草稿的網址識別碼（只能使用小寫英文、數字、-）",candidate);
    if(!suggested) return;
    if(!window.confirm(
      "這只會建立一份獨立的「未公開草稿」。即使移除 [[連結]] 記號，仍可能含有私人資訊。請在文章工作室仔細檢查後，再自行決定是否發布。確定建立？"
    )) return;
    setBusy(true);setError("");
    try {
      const result=await createVaultPublicDraft(initial.id,suggested);
      if(!result.ok) {setError(result.error);return;}
      router.push(`/studio/${result.id}`);
    } catch {setError("公開草稿無法建立，請稍後再試。");}
    finally {setBusy(false);}
  }

  return <section className="vault-root container">
    <div className="vault-topline">
      <Link href="/vault" className="back-link"><ArrowLeft size={16}/> 返回私人知識庫</Link>
      <span className="vault-privacy"><BookLock size={15}/> 預設私人 · 不會自動發布</span>
    </div>
    <div className="vault-heading">
      <div><span className="section-kicker">KNOWLEDGE DESK / PRIVATE</span>
        <h1>{initial?"編輯知識節點":"建立知識節點"}<span className="title-period">.</span></h1>
        <p>把知識留在自己的空間，再用 [[知識名稱]] 與其他筆記連結。</p></div>
      <button type="button" className="button-primary" disabled={busy} onClick={save}>
        <Save size={16}/>{busy?"儲存中…":"儲存私人筆記"}
      </button>
    </div>
    {error&&<p className="editor-error" role="alert">{error}</p>}
    {notice&&<p className="vault-success" role="status"><Check size={15}/>{notice}</p>}
    <div className="vault-workspace">
      <div className="vault-document">
        <label htmlFor="vault-title">知識標題</label>
        <input id="vault-title" className="editor-title-input" maxLength={160}
          placeholder="這個知識節點叫什麼？" value={title} onChange={e=>updateTitle(e.target.value)}/>
        <label htmlFor="vault-summary">一句話摘要</label>
        <textarea id="vault-summary" className="editor-excerpt-input" rows={2} maxLength={400}
          value={summary} placeholder="日後搜尋這則知識時的重要線索…" onChange={e=>setSummary(e.target.value)}/>
        <div className="vault-content-heading">
          <span>MARKDOWN / [[KNOWLEDGE LINKS]]</span>
          <button type="button" onClick={()=>setPreview(p=>!p)} aria-pressed={preview}>
            {preview?<FilePenLine size={16}/>:<Eye size={16}/>} {preview?"繼續編輯":"預覽關聯"}
          </button>
        </div>
        <div className="vault-linkbar">
          <label htmlFor="vault-link-target">建立知識關聯</label>
          <select id="vault-link-target" value={targetSlug} onChange={e=>setTargetSlug(e.target.value)}>
            <option value="">選擇目標筆記</option>
            {targets.filter(t=>t.id!==initial?.id).map(t=><option value={t.slug} key={t.id}>{t.title}</option>)}
          </select>
          <button type="button" disabled={preview} onMouseDown={e=>e.preventDefault()} onClick={insertLink}>
            <Link2 size={15}/> 插入 [[連結]]
          </button>
        </div>
        {preview ? <div className="vault-markdown-preview"><Markdown
          content={content||"*這篇私人筆記還沒有正文。*"} wikiTargets={wikiTargets}/></div> :
          <><label htmlFor="vault-content" className="visually-hidden">Markdown 正文</label>
            <textarea ref={editor} id="vault-content" className="content-textarea"
              maxLength={200000} spellCheck={false} value={content} onChange={e=>setContent(e.target.value)}
              placeholder={"## 我理解的是…\n\n[[neon-auth]] 跟 [[RLS|資料隔離]] 有什麼關係？"}/></>}
        <div className="vault-document-footer"><span>未儲存變更不會上傳雲端</span>
          <span>{content.length.toLocaleString("zh-TW")} / 200,000</span></div>
        <div className="vault-file-tools">
          <input ref={backupFile} type="file" className="visually-hidden"
            accept=".md,.markdown,text/markdown,text/plain"
            onChange={e=>{const f=e.currentTarget.files?.[0];e.currentTarget.value="";void importBackup(f);}}/>
          <button type="button" onClick={()=>backupFile.current?.click()}><Upload size={15}/> 匯入 Markdown</button>
          <button type="button" onClick={downloadBackup}><Download size={15}/> 下載 .md 備份</button>
          <button type="button" disabled={!title.trim()} onClick={downloadObsidian}>
            <Download size={15}/> Obsidian .md
          </button>
        </div>
      </div>

      <aside className="vault-sidebar" aria-label="私人知識設定與關聯">
        <h2>知識屬性</h2>
        <label htmlFor="vault-slug">筆記識別碼</label>
        <input id="vault-slug" maxLength={120} value={slug}
          placeholder="my-knowledge-node" onChange={e=>{manualSlug.current=true;setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,""));}}/>
        <label htmlFor="vault-category">分類</label>
        <input id="vault-category" maxLength={36} value={category} onChange={e=>setCategory(e.target.value)}/>
        <label htmlFor="vault-tags">標籤（逗號分隔）</label>
        <input id="vault-tags" value={tagsText} onChange={e=>setTagsText(e.target.value)} placeholder="AI, 開發, 閱讀"/>
        <label htmlFor="vault-date">學習日期</label>
        <input id="vault-date" type="date" value={learnedOn} onChange={e=>setLearnedOn(e.target.value)}/>

        <div className="vault-side-rule"/>
        <h2><Link2 size={16}/> 知識關係</h2>
        <Link href={initial?`/vault/graph?focus=${initial.id}`:"/vault/graph"}
          className="vault-relation"><Network size={16}/> 在知識網絡查看 <ArrowRight size={15}/></Link>
        {!initial?<p>儲存後會顯示反向連結，以及尚未找到對應筆記的連結。</p>:<>
          <h3>連向其他知識</h3>
          {relations?.outgoing.length?relations.outgoing.map((r,i)=>
            <Link key={r.key+i} href={`/vault/${r.note.id}`} className="vault-relation">
              {r.note.title}<ArrowRight size={14}/>
            </Link>):<p>尚未建立已解析的連結。</p>}
          <h3>誰引用了這篇筆記（Backlinks）</h3>
          {relations?.backlinks.length?relations.backlinks.map((r,i)=>
            <Link key={r.key+i} href={`/vault/${r.note.id}`} className="vault-relation">
              {r.note.title}<ArrowRight size={14}/>
            </Link>):<p>目前還沒有其他知識引用它。</p>}
          {!!relations?.unresolved.length&&<><h3>待建立的知識</h3>
            {relations.unresolved.map(k=><code key={k} className="vault-unresolved">[[{k}]]</code>)}
          </>}
        </>}

        {allowPublication&&<><div className="vault-side-rule"/>
        <h2><ShieldCheck size={16}/> 選擇性公開</h2>
        <p>私人原稿永遠不會因為建立連結而公開。需要分享時，只能先產生獨立的未發布草稿。</p>
        {initial&&<button className="vault-publish-draft" type="button"
          disabled={busy||dirty} onClick={createPublicDraft}>
          <Globe2 size={15}/> 建立獨立公開草稿
        </button>}
        {initial&&dirty&&<p>請先儲存私人變更，才能從最新版本建立公開草稿。</p>}</>}
        {initial&&<button type="button" className="vault-delete" onClick={remove} disabled={busy}>
          <Trash2 size={15}/> 刪除私人筆記
        </button>}
      </aside>
    </div>
  </section>;
}
