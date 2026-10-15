"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, Eye, FileEdit, Globe2, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import Markdown from "@/components/markdown";
import { savePost, deletePost } from "@/app/actions";
import { slugify, todayTaipei } from "@/lib/format";
import type { Post, PostInput, PostStatus } from "@/lib/types";

export default function StudioEditor({initial}: {initial?:Post}) {
  const router = useRouter();
  const [title,setTitle] = useState(initial?.title || "");
  const [slug,setSlug] = useState(initial?.slug || "");
  const [excerpt,setExcerpt] = useState(initial?.excerpt || "");
  const [content,setContent] = useState(initial?.content_md || "");
  const [tagsText,setTagsText] = useState(initial?.tags.join(", ") || "");
  const [category,setCategory] = useState(initial?.category || "筆記");
  const [learnedOn,setLearnedOn] = useState(initial?.learned_on || todayTaipei());
  const [status,setStatus] = useState<PostStatus>(initial?.status || "draft");
  const [preview,setPreview] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [localStatus,setLocalStatus] = useState("所有變更會在此裝置暫存");
  const manualSlug = useRef(Boolean(initial));
  const draftKey = `naosledge-local-draft-${initial?.id || "new"}`;
  // Keep compatible with browser-local drafts written by the old brand.
  const legacyDraftKey = `learnlog-local-draft-${initial?.id || "new"}`;
  const restored = useRef(false);

  useEffect(() => {
    {
      try {
        const raw = localStorage.getItem(draftKey) ?? localStorage.getItem(legacyDraftKey);
        if (raw) {
          const previous = JSON.parse(raw);
          // Do not overwrite a more recent cloud version with stale local text.
          const isNewer = !initial || (typeof previous.savedAt === "number" && previous.savedAt > new Date(initial.updated_at).getTime());
          if (isNewer) {
          if (typeof previous.title === "string") setTitle(previous.title);
          if (typeof previous.slug === "string") setSlug(previous.slug);
          if (typeof previous.excerpt === "string") setExcerpt(previous.excerpt);
          if (typeof previous.content === "string") setContent(previous.content);
          if (typeof previous.tagsText === "string") setTagsText(previous.tagsText);
          if (typeof previous.category === "string") setCategory(previous.category);
          if (typeof previous.learnedOn === "string") setLearnedOn(previous.learnedOn);
          if (previous.slug) manualSlug.current = true;
          setLocalStatus("已恢復上次在這台裝置的草稿");
          }
        }
      } catch { /* Ignore unreadable local cache. */ }
    }
    restored.current = true;
  }, [draftKey,initial]);

  useEffect(() => {
    if (!restored.current) return;
    setLocalStatus("正在暫存變更…");
    const timer = window.setTimeout(() => {
      try {localStorage.setItem(draftKey, JSON.stringify({title,slug,excerpt,content,tagsText,category,learnedOn,savedAt:Date.now()}));
        setLocalStatus("已自動暫存在這台裝置 · 點選儲存才會同步到網站"); }
      catch {setLocalStatus("暫存失敗，請儘速點選儲存");}
    }, 700);
    return () => window.clearTimeout(timer);
  }, [title,slug,excerpt,content,tagsText,category,learnedOn,draftKey]);

  function updateTitle(next:string) {
    setTitle(next);
    if (!manualSlug.current && !initial) {
      const suggested = slugify(next);
      if (suggested.length >= 3) setSlug(suggested);
      else if (!slug) setSlug(`note-${todayTaipei().replaceAll("-","")}-${Math.random().toString(36).slice(2,7)}`);
    }
  }

  async function persist(next:PostStatus) {
    setError(""); setBusy(true);
    const payload:PostInput = {
      id:initial?.id,title,slug,excerpt,content_md:content,
      tags:tagsText.split(/[,，\n]/g).map(x=>x.trim()).filter(Boolean),
      category,status:next,learned_on:learnedOn,
    };
    try {
      const result = await savePost(payload);
      if (!result.ok) {setError(result.error); return;}
      localStorage.removeItem(draftKey);
      localStorage.removeItem(legacyDraftKey);
      setStatus(next);
      router.replace("/studio"); router.refresh();
    } catch {setError("儲存時發生錯誤，請確認網路或重新登入。");}
    finally {setBusy(false);}
  }

  async function remove() {
    if (!initial || !window.confirm("確定永久刪除這篇文章？此操作無法復原。")) return;
    setBusy(true); setError("");
    try { const result = await deletePost(initial.id);
      if (!result.ok) {setError(result.error||"刪除失敗");return;}
      localStorage.removeItem(draftKey);
      localStorage.removeItem(legacyDraftKey); router.replace("/studio"); router.refresh();
    } catch {setError("無法刪除文章，請重試。");}
    finally {setBusy(false);}
  }

  return <section className="editor-page container">
    <div className="editor-topbar"><Link href="/studio" className="back-link"><ArrowLeft size={17}/> 返回工作室</Link>
      <div className="editor-top-right"><span className="autosave-text"><Check size={13}/> {localStatus}</span><span className={status==="published"?"status-pill published":"status-pill draft"}>{status==="published"?"已發布":"草稿"}</span></div>
    </div>
    <div className="editor-title-row"><div><span className="section-kicker">WRITING DESK / {initial ? "EDIT ENTRY" : "NEW ENTRY"}</span><h1>{initial?"編輯筆記":"寫一篇新的筆記"}<span className="title-period">.</span></h1></div>
      <div className="editor-actions">
        {initial && <button type="button" className="delete-button" disabled={busy} onClick={remove} aria-label="永久刪除文章" title="永久刪除文章"><Trash2 size={17}/></button>}
        <button type="button" className="button-ghost" disabled={busy} onClick={()=>persist("draft")}><Save size={16}/> 儲存草稿</button>
        <button type="button" className="button-primary" disabled={busy} onClick={()=>persist("published")}><Globe2 size={16}/> {status==="published"?"更新公開文章":"發布文章"}<ArrowUpRight size={16}/></button>
      </div>
    </div>
    {error && <div className="editor-error" role="alert">{error}</div>}
    <div className="editor-workspace">
      <div className="editor-document">
        <div className="editor-paper-top"><span>NAOSLEDGE / MANUSCRIPT</span><span>{learnedOn}</span></div>
        <label htmlFor="post-title" className="visually-hidden">筆記標題（必填）</label>
        <input id="post-title" maxLength={160} value={title} onChange={e=>updateTitle(e.target.value)} placeholder="這篇筆記的標題…" className="editor-title-input"/>
        <label htmlFor="post-excerpt" className="visually-hidden">文章摘要</label>
        <textarea id="post-excerpt" rows={2} maxLength={400} value={excerpt} onChange={e=>setExcerpt(e.target.value)} placeholder="用一兩句話，記下這篇筆記的重點（可選）" className="editor-excerpt-input"/>
        <div className="editor-content-bar"><span>CONTENT / MARKDOWN</span><button type="button" onClick={()=>setPreview(!preview)} className="preview-switch" aria-pressed={preview}>{preview?<FileEdit size={16}/>:<Eye size={16}/>} {preview?"返回編輯":"文章預覽"}</button></div>
        {preview?<div className="editor-md-preview"><Markdown content={content || "*目前還沒有內容。*"}/></div>
          :<><label htmlFor="post-content" className="visually-hidden">文章內容（Markdown，必填）</label><textarea id="post-content" className="content-textarea" value={content} onChange={e=>setContent(e.target.value)} placeholder={"從今天最有意思的一件事開始。\n\n## 我學到了什麼？\n\n寫下你的理解、範例和資料來源…"} spellCheck={false}/></>}
        <div className="editor-paper-foot"><span>WRITE. REVISE. RETURN.</span><span>{content.length.toLocaleString("zh-TW")} 字元</span></div>
      </div>
      <aside className="editor-settings" aria-label="文章設定"><div className="editor-sidebar-head"><span className="section-kicker">PUBLISHING DETAILS</span><h2>文章設定</h2></div>
        <div className="field-group"><label htmlFor="post-date">學習日期</label><input id="post-date" type="date" value={learnedOn} onChange={e=>setLearnedOn(e.target.value)}/></div>
        <div className="field-group"><label htmlFor="post-category">分類</label><input id="post-category" maxLength={36} value={category} onChange={e=>setCategory(e.target.value)} placeholder="例如：技術、閱讀、生活"/></div>
        <div className="field-group"><label htmlFor="post-tags">標籤 <span className="sub-label">以逗號分隔</span></label><input id="post-tags" value={tagsText} onChange={e=>setTagsText(e.target.value)} placeholder="Git, 設計, 閱讀筆記"/></div>
        <div className="field-group"><label htmlFor="post-slug">文章網址 <span className="sub-label">英文 slug</span></label><div className="slug-field"><span>/notes/</span><input id="post-slug" value={slug} onChange={e=>{manualSlug.current=true;setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,120));}} placeholder="my-learning-note"/></div></div>
        <div className="editor-help"><strong>儲存與公開</strong><p>內容會先暫存在目前裝置。點選「儲存草稿」才會同步到雲端；點選「發布文章」後，所有訪客都能閱讀。</p><div className="editor-mini-rule"/><strong>Markdown 快捷參考</strong><code>## 小標題</code><code>**重點**</code><code>- 清單</code><code>```程式碼```</code></div>
      </aside>
    </div>
  </section>;
}
