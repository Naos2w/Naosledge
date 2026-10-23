"use client";

import {useMemo,useState} from "react";
import Link from "next/link";
import {
  ArrowLeft,ArrowDownToLine,ArrowUpFromLine,Check,ChevronRight,
  GitCompareArrows,LockKeyhole,RotateCcw,Search,ShieldCheck,ShieldAlert,
} from "lucide-react";
import type {ManualReviewPreview} from "@/lib/obsidian-manual-sync-review";
import type {SyncChoice} from "@/lib/obsidian-sync-plan";
import {
  chooseReviewIntent,reviewIntentOptions,summariseReviewIntents,
  type ReviewIntent,type ReviewIntentSelections,
} from "@/lib/obsidian-m2-review-choices";

const STATUS:Record<SyncChoice,{text:string;message:string;kind:string}>={
  "review-upload":{text:"Obsidian 有修改",message:"本機已修改，NaosLedge 仍是舊版本。",kind:"local"},
  "review-download":{text:"NaosLedge 有修改",message:"雲端已修改，Obsidian 仍是舊版本。",kind:"remote"},
  "conflict":{text:"雙邊衝突",message:"兩邊都有不同修改，絕不自動選擇覆寫哪一份。",kind:"conflict"},
  "review-missing-remote":{text:"僅 Obsidian 存在",message:"NaosLedge 沒有對應筆記；不推論曾經刪除。",kind:"local"},
  "review-missing-local":{text:"僅 NaosLedge 存在",message:"Obsidian 沒有對應筆記；不推論曾經刪除。",kind:"remote"},
  "unchanged":{text:"內容一致",message:"兩端指紋相同，無須處理。",kind:"same"},
  "both-removed":{text:"兩端均缺失",message:"曾有同步基準，但兩邊目前均缺失；不產生刪除操作。",kind:"missing"},
};
const INTENT_LABEL:Record<ReviewIntent,string>={
  upload:"預定上傳",download:"預定下載","keep-both":"保留兩份",skip:"略過",
};
const INTENT_ICON={
  upload:ArrowUpFromLine,download:ArrowDownToLine,"keep-both":GitCompareArrows,skip:Check,
};
type Filter="all"|"review"|"conflict"|"done";

export default function VaultManualSyncReview({preview}:{preview:ManualReviewPreview}){
  const [choices,setChoices]=useState<ReviewIntentSelections>({});
  const [filter,setFilter]=useState<Filter>("all");
  const [query,setQuery]=useState("");
  const [showSummary,setShowSummary]=useState(false);
  const tally=useMemo(()=>summariseReviewIntents(preview,choices),[preview,choices]);
  const visible=useMemo(()=>preview.decisions.filter(row=>{
    const match=row.slug.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    if(!match)return false;
    if(filter==="review")return row.perNoteConfirmationRequired;
    if(filter==="conflict")return row.choice==="conflict";
    if(filter==="done")return !row.perNoteConfirmationRequired;
    return true;
  }),[preview,filter,query]);

  function choose(slug:string,intent:ReviewIntent){
    setChoices(before=>chooseReviewIntent(preview,before,slug,intent));
    setShowSummary(false);
  }

  return <section className="vault-root container vault-sync-page">
    <div className="vault-topline">
      <Link className="back-link" href="/vault"><ArrowLeft size={16}/> 返回私人知識庫</Link>
      <span className="vault-privacy"><LockKeyhole size={15}/> 僅站長可見</span>
    </div>
    <header className="vault-sync-header">
      <div>
        <span className="section-kicker">PRIVATE VAULT / M2 REVIEW</span>
        <h1>同步審查<span className="title-period">.</span></h1>
        <p>逐篇決定下一步，再確認整份清單。Obsidian 與 NaosLedge 的原稿都受到保護。</p>
      </div>
      <span className="vault-sync-demo-label">互動預演 · 合成筆記</span>
    </header>

    <div className="vault-sync-notice" role="status">
      <ShieldCheck aria-hidden="true" size={20}/>
      <div>
        <strong>目前不會執行同步。</strong>
        <span>畫面使用虛構資料，沒有讀取真實 Obsidian 筆記或 Neon 內容。所有選擇只保留在本頁記憶體，不會上傳、下載、覆寫、刪除或建立授權。</span>
      </div>
    </div>

    <div className="vault-sync-totals" aria-label="同步差異摘要">
      <div><strong>{preview.decisions.length}</strong><span>筆示例</span></div>
      <div><strong>{tally.needsReview}</strong><span>待審查</span></div>
      <div><strong>{preview.conflicts}</strong><span>雙邊衝突</span></div>
      <div><strong>{tally.selected}</strong><span>已選擇</span></div>
      <p>只顯示 M1 判斷結果與兩端版本指紋；目前不提供正文差異檢視。</p>
    </div>

    <div className="vault-sync-list-heading">
      <div>
        <span className="section-kicker">01 / REVIEW QUEUE</span>
        <h2>逐篇決定處理方式</h2>
      </div>
      <span aria-live="polite">已選 {tally.selected}／{tally.needsReview} 篇</span>
    </div>
    <div className="vault-sync-toolbar">
      <div className="vault-sync-filters" aria-label="差異類型篩選">
        {([
          ["all","全部"],["review","待審查"],["conflict","衝突"],["done","無須處理"],
        ] as const).map(([value,label])=>
          <button key={value} type="button" aria-pressed={filter===value}
            onClick={()=>setFilter(value)}>{label}</button>
        )}
      </div>
      <label className="vault-sync-search">
        <Search size={17} aria-hidden="true"/>
        <span className="visually-hidden">搜尋範例筆記</span>
        <input value={query} onChange={e=>setQuery(e.target.value)}
          type="search" maxLength={120} placeholder="搜尋筆記名稱" aria-label="搜尋範例筆記"/>
      </label>
    </div>

    <ol className="vault-sync-notes">
      {visible.map(row=>{
        const status=STATUS[row.choice];
        const options=reviewIntentOptions(row.choice);
        const selected=choices[row.slug];
        return <li key={row.slug} className="vault-sync-note">
          <div className="vault-sync-note-main">
            <div className="vault-sync-note-id">
              <span className="vault-sync-note-state" data-kind={status.kind}>{status.text}</span>
              <span className="vault-sync-note-slug">{row.slug}.md</span>
            </div>
            <h3>{row.slug}</h3>
            <p>{status.message}</p>
            <dl className="vault-sync-versions">
              <div><dt>Obsidian</dt><dd title="合成資料 SHA-256 指紋">{row.expectedLocalSha?.slice(0,10)??"不存在"}</dd></div>
              <div><dt>NaosLedge</dt><dd title="合成資料 SHA-256 指紋">{row.expectedRemoteSha?.slice(0,10)??"不存在"}</dd></div>
            </dl>
          </div>
          <div className="vault-sync-note-actions">
            {options.length>0 ? <>
              <span className="vault-sync-action-label">選擇審查意圖（不會執行）</span>
              <div className="vault-sync-options" role="group" aria-label={row.slug+" 的審查意圖"}>
                {options.map(intent=>{
                  const Icon=INTENT_ICON[intent];
                  return <button type="button" key={intent}
                    aria-pressed={selected===intent}
                    onClick={()=>choose(row.slug,intent)}>
                    <Icon size={15} aria-hidden="true"/>{INTENT_LABEL[intent]}
                  </button>;
                })}
              </div>
              <small aria-live="polite">{selected?"已記下選擇："+INTENT_LABEL[selected]:"尚未選擇，不會進行任何動作"}</small>
            </> : <span className="vault-sync-inactive"><ShieldCheck size={16}/> 不執行任何操作</span>}
          </div>
        </li>;
      })}
      {visible.length===0 && <li className="vault-sync-no-results">沒有符合條件的筆記；請清除搜尋或切換篩選。</li>}
    </ol>

    <div className="vault-sync-bottom">
      <div>
        <span className="section-kicker">02 / REVIEW SUMMARY</span>
        <h2>檢查本次選擇</h2>
        <p>已選擇 {tally.selected} 篇，尚有 {tally.pending} 篇未選。尚未選擇的筆記一律不處理。</p>
      </div>
      <div className="vault-sync-bottom-controls">
        <button type="button" className="vault-sync-clear"
          disabled={tally.selected===0}
          onClick={()=>{setChoices({});setShowSummary(false);}}>
          <RotateCcw size={16}/> 清除選擇
        </button>
        <button type="button" className="button-primary"
          aria-expanded={showSummary} aria-controls="vault-sync-review-summary"
          onClick={()=>setShowSummary(x=>!x)}>
          {showSummary?"收合審查摘要":"查看審查摘要"}<ChevronRight size={16}/>
        </button>
      </div>
    </div>

    {showSummary&&<section id="vault-sync-review-summary" className="vault-sync-final"
      aria-labelledby="vault-sync-final-heading" tabIndex={-1}>
      <h3 id="vault-sync-final-heading">本頁暫存的審查意圖</h3>
      <div className="vault-sync-final-counts">
        <span>預定上傳 <strong>{tally.upload}</strong></span>
        <span>預定下載 <strong>{tally.download}</strong></span>
        <span>保留兩份 <strong>{tally.keepBoth}</strong></span>
        <span>略過 <strong>{tally.skipped}</strong></span>
        <span>未選 <strong>{tally.pending}</strong></span>
      </div>
      <ul>
        {preview.decisions.filter(row=>choices[row.slug]).map(row=><li key={row.slug}>
          <span>{row.slug}.md</span><strong>{INTENT_LABEL[choices[row.slug]]}</strong>
        </li>)}
        {tally.selected===0&&<li>目前沒有任何審查選擇。</li>}
      </ul>
      <p className="vault-sync-final-warning"><ShieldAlert size={18} aria-hidden="true"/>
        這不是同步執行清單，也沒有「批准上傳」效力。離開或重新整理頁面後，選擇會消失；真正操作需在後續 M3／M4 重新核對兩端版本並取得本人確認。</p>
    </section>}
  </section>;
}
