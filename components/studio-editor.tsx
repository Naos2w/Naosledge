"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Bold, Check, Code2, Download, Eye, FileEdit, Globe2, Heading2, ImagePlus, Italic, Link2, List, Save, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import Markdown from "@/components/markdown";
import { savePost, deletePost } from "@/app/actions";
import { slugify, todayTaipei } from "@/lib/format";
import { applyMarkdownTool, type MarkdownTool } from "@/lib/markdown-editor";
import { markdownBackupFilename, parseMarkdownBackup, serializeMarkdownBackup } from "@/lib/markdown-backup";
import type { Post, PostInput, PostStatus } from "@/lib/types";

const markdownTools = [
  { key: "heading", label: "標題", icon: Heading2 },
  { key: "bold", label: "粗體", icon: Bold },
  { key: "italic", label: "斜體", icon: Italic },
  { key: "list", label: "清單", icon: List },
  { key: "link", label: "連結", icon: Link2 },
  { key: "image", label: "圖片", icon: ImagePlus },
  { key: "code", label: "程式碼", icon: Code2 },
] as const;

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
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);
  const didCommit = useRef(false);
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

  function saveLocalNow() {
    if (!restored.current || didCommit.current) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        title, slug, excerpt, content, tagsText, category, learnedOn, savedAt: Date.now(),
      }));
      setLocalStatus("已暫存在這台裝置 · 點選儲存才會同步到網站");
    } catch {
      setLocalStatus("暫存失敗，請儘速點選儲存");
    }
  }

  useEffect(() => {
    if (!restored.current || didCommit.current) return;
    setLocalStatus("正在暫存變更…");
    // Also flush when a tab closes or a note field loses focus on mobile.
    const flush = () => {
      if (didCommit.current) return false;
      try {
        localStorage.setItem(draftKey, JSON.stringify({
          title, slug, excerpt, content, tagsText, category, learnedOn, savedAt: Date.now(),
        }));
        return true;
      } catch { return false; }
    };
    const timer = window.setTimeout(() => {
      if (didCommit.current) return;
      setLocalStatus(flush()
        ? "已暫存在這台裝置 · 點選儲存才會同步到網站"
        : "暫存失敗，請儘速點選儲存");
    }, 700);
    window.addEventListener("pagehide", flush);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
    };
  }, [title,slug,excerpt,content,tagsText,category,learnedOn,draftKey]);

  function applyTool(tool: MarkdownTool) {
    const editor = editorRef.current;
    if (!editor) return;
    const change = applyMarkdownTool(content, editor.selectionStart, editor.selectionEnd, tool);
    if (change.text.length > 200_000) {
      setError("文章內容不得超過 200,000 字元。");
      return;
    }
    setError("");
    setContent(change.text);
    requestAnimationFrame(() => {
      const target = editorRef.current;
      if (!target) return;
      target.focus({preventScroll: true});
      target.setSelectionRange(change.selectionStart, change.selectionEnd);
    });
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const tool = event.key.toLowerCase() === "b" ? "bold" : event.key.toLowerCase() === "k" ? "link" : null;
    if (tool) {
      event.preventDefault();
      applyTool(tool);
    }
  }

  function updateTitle(next:string) {
    setTitle(next);
    if (!manualSlug.current && !initial) {
      const suggested = slugify(next);
      if (suggested.length >= 3) setSlug(suggested);
      else if (!slug) setSlug(`note-${todayTaipei().replaceAll("-","")}-${Math.random().toString(36).slice(2,7)}`);
    }
  }

  function downloadMarkdown() {
    try {
      const backup = serializeMarkdownBackup({
        title, slug, excerpt, category, learned_on: learnedOn,
        tags: tagsText.split(/[,，\n]/g).map((tag)=>tag.trim()).filter(Boolean),
        content_md: content,
      });
      const blob = new Blob([backup], {type:"text/markdown;charset=utf-8"});
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = markdownBackupFilename(title, slug);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(objectUrl), 1500);
      setError("");
      setLocalStatus("已下載 Markdown 備份 · 僅保存在你選擇的裝置位置");
    } catch {
      setError("無法產生 Markdown 備份，請檢查瀏覽器下載設定。");
    }
  }

  async function importMarkdown(file?:File) {
    if (!file) return;
    if (file.size > 1_000_000) {
      setError("Markdown 檔案超過 1 MB，請先縮減內容。");
      return;
    }
    setError("");
    try {
      const imported = parseMarkdownBackup(await file.text());
      if (!window.confirm("匯入會取代目前編輯器的內容與本機草稿。檔案不會上傳或自動發布，確定繼續嗎？")) return;
      const restoredTitle = imported.metadata?.title ?? title;
      const restoredSlug = imported.metadata?.slug ?? slug;
      const restoredExcerpt = imported.metadata?.excerpt ?? excerpt;
      const restoredTags = imported.metadata?.tags.join(", ") ?? tagsText;
      const restoredCategory = imported.metadata?.category ?? category;
      const restoredDate = imported.metadata?.learned_on ?? learnedOn;
      setTitle(restoredTitle);
      setSlug(restoredSlug);
      setExcerpt(restoredExcerpt);
      setContent(imported.content_md);
      setTagsText(restoredTags);
      setCategory(restoredCategory);
      setLearnedOn(restoredDate);
      setStatus("draft"); // Never publish imported content automatically.
      setPreview(false);
      manualSlug.current = Boolean(restoredSlug);
      try {
        localStorage.setItem(draftKey, JSON.stringify({
          title: restoredTitle, slug: restoredSlug, excerpt: restoredExcerpt,
          content: imported.content_md, tagsText: restoredTags,
          category: restoredCategory, learnedOn: restoredDate, savedAt: Date.now(),
        }));
        setLocalStatus("已匯入 Markdown，並暫存在此裝置 · 尚未同步雲端");
      } catch {
        setLocalStatus("Markdown 已匯入，但本機暫存失敗，請先下載備份");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Markdown 檔案無法讀取。");
    }
  }

  async function persist(next:PostStatus) {
    if (initial?.status === "published" && next === "draft" &&
        !window.confirm("這篇文章目前已公開。下架後讀者將無法再看到它，確定要改為草稿嗎？")) return;
    setError(""); setBusy(true);
    const payload:PostInput = {
      id:initial?.id,title,slug,excerpt,content_md:content,
      tags:tagsText.split(/[,，\n]/g).map(x=>x.trim()).filter(Boolean),
      category,status:next,learned_on:learnedOn,
    };
    try {
      const result = await savePost(payload);
      if (!result.ok) {setError(result.error); return;}
      didCommit.current = true;
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
      didCommit.current = true;
      localStorage.removeItem(draftKey);
      localStorage.removeItem(legacyDraftKey); router.replace("/studio"); router.refresh();
    } catch {setError("無法刪除文章，請重試。");}
    finally {setBusy(false);}
  }

  return <section className="editor-page container">
    <div className="editor-topbar"><Link href="/studio" className="back-link" onClick={saveLocalNow}><ArrowLeft size={17}/> 返回工作室</Link>
      <div className="editor-top-right"><span className="autosave-text"><Check size={13}/> {localStatus}</span><span className={status==="published"?"status-pill published":"status-pill draft"}>{status==="published"?"已發布":"草稿"}</span></div>
    </div>
    <div className="editor-title-row"><div><span className="section-kicker">WRITING DESK / {initial ? "EDIT ENTRY" : "NEW ENTRY"}</span><h1>{initial?"編輯筆記":"寫一篇新的筆記"}<span className="title-period">.</span></h1></div>
      <div className="editor-actions">
        {initial && <button type="button" className="delete-button" disabled={busy} onClick={remove} aria-label="永久刪除文章" title="永久刪除文章"><Trash2 size={17}/></button>}
        <button type="button" className="button-ghost" disabled={busy} onClick={()=>persist("draft")}><Save size={16}/> {initial?.status === "published" ? "下架為草稿" : "儲存草稿"}</button>
        <button type="button" className="button-primary" disabled={busy} onClick={()=>persist("published")}><Globe2 size={16}/> {status==="published"?"更新公開文章":"發布文章"}<ArrowUpRight size={16}/></button>
      </div>
    </div>
    {error && <div className="editor-error" role="alert" id="editor-error">{error}</div>}
    <div className="editor-workspace">
      <div className="editor-document">
        <div className="editor-paper-top"><span>NAOSLEDGE / MANUSCRIPT</span><span>{learnedOn}</span></div>
        <label htmlFor="post-title" className="visually-hidden">筆記標題（必填）</label>
        <input id="post-title" maxLength={160} value={title} onChange={e=>updateTitle(e.target.value)} onBlur={saveLocalNow} placeholder="這篇筆記的標題…" className="editor-title-input"/>
        <label htmlFor="post-excerpt" className="visually-hidden">文章摘要</label>
        <textarea id="post-excerpt" rows={2} maxLength={400} value={excerpt} onChange={e=>setExcerpt(e.target.value)} onBlur={saveLocalNow} placeholder="用一兩句話，記下這篇筆記的重點（可選）" className="editor-excerpt-input"/>
        <div className="editor-content-bar"><span>CONTENT / MARKDOWN</span><button type="button" onClick={()=>setPreview(!preview)} className="preview-switch" aria-pressed={preview}>{preview?<FileEdit size={16}/>:<Eye size={16}/>} {preview?"返回編輯":"文章預覽"}</button></div>
        <div className="markdown-backup-actions" role="group" aria-label="Markdown 本機備份工具">
          <input ref={backupFileRef} id="markdown-backup-file" type="file"
            accept=".md,.markdown,text/markdown,text/plain" className="visually-hidden"
            onChange={(event)=>{const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void importMarkdown(file);}}/>
          <button type="button" disabled={busy} onClick={()=>backupFileRef.current?.click()}>
            <Upload size={15} aria-hidden="true"/> 匯入 .md
          </button>
          <button type="button" disabled={busy} onClick={downloadMarkdown}>
            <Download size={15} aria-hidden="true"/> 下載 .md 備份
          </button>
          <span>本機檔案 · 不會自動發布</span>
        </div>
{!preview && <div className="markdown-toolbar" role="group" aria-label="Markdown 格式工具列">
          {markdownTools.map(({key,label,icon:Icon}) => <button key={key} type="button"
            className="markdown-tool" title={key==="bold" ? "粗體（Ctrl/⌘+B）" : key==="link" ? "連結（Ctrl/⌘+K）" : key==="image" ? "插入 HTTPS 圖片網址並加上替代文字" : label}
            aria-label={label} aria-controls="post-content"
            onMouseDown={event=>event.preventDefault()} onClick={()=>applyTool(key)}>
            <Icon size={16} aria-hidden="true"/><span>{label}</span>
          </button>)}
        </div>}
        {preview?<div className="editor-md-preview" role="region" aria-label="文章 Markdown 預覽"><Markdown content={content || "*目前還沒有內容。*"}/></div>
          :<><label htmlFor="post-content" className="visually-hidden">文章內容（Markdown，必填）</label>
            <textarea ref={editorRef} id="post-content" className="content-textarea" maxLength={200000}
              value={content} onChange={e=>setContent(e.target.value)} onBlur={saveLocalNow} onKeyDown={onEditorKeyDown}
              placeholder={"從今天最有意思的一件事開始。\n\n## 我學到了什麼？\n\n寫下你的理解、範例和資料來源…"}
              aria-describedby={error ? "editor-error" : undefined} spellCheck={false}/></>}
        <div className="editor-paper-foot"><span>WRITE. REVISE. RETURN.</span><span>{content.length.toLocaleString("zh-TW")} / 200,000 字元</span></div>
      </div>
      <aside className="editor-settings" aria-label="文章設定"><div className="editor-sidebar-head"><span className="section-kicker">PUBLISHING DETAILS</span><h2>文章設定</h2></div>
        <div className="field-group"><label htmlFor="post-date">學習日期</label><input id="post-date" type="date" value={learnedOn} onChange={e=>setLearnedOn(e.target.value)} onBlur={saveLocalNow}/></div>
        <div className="field-group"><label htmlFor="post-category">分類</label><input id="post-category" maxLength={36} value={category} onChange={e=>setCategory(e.target.value)} onBlur={saveLocalNow} placeholder="例如：技術、閱讀、生活"/></div>
        <div className="field-group"><label htmlFor="post-tags">標籤 <span className="sub-label">以逗號分隔</span></label><input id="post-tags" value={tagsText} onChange={e=>setTagsText(e.target.value)} onBlur={saveLocalNow} placeholder="Git, 設計, 閱讀筆記"/></div>
        <div className="field-group"><label htmlFor="post-slug">文章網址 <span className="sub-label">英文 slug</span></label><div className="slug-field"><span>/notes/</span><input id="post-slug" value={slug} onChange={e=>{manualSlug.current=true;setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,120));}} onBlur={saveLocalNow} placeholder="my-learning-note"/></div></div>
        <div className="editor-help"><strong>儲存與公開</strong><p>內容會先暫存在目前裝置。點選「儲存草稿」才會同步到雲端；點選「發布文章」後，所有訪客都能閱讀。</p><div className="editor-mini-rule"/><strong>圖片與 Markdown</strong><p>圖片使用 HTTPS 圖片網址或本站根目錄路徑，不支援直接上傳。請寫清楚圖片替代文字；外部圖片網站仍可能看到讀者的 IP 位址。</p><code>![架構流程圖](https://your-domain.example/image.jpg "圖片說明")</code><div className="editor-mini-rule"/><strong>Markdown 快捷參考</strong><code>## 小標題</code><code>**重點**</code><code>- 清單</code><code>```程式碼```</code></div>
      </aside>
    </div>
  </section>;
}
