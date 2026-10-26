"use client";

import {useMemo,useState} from "react";
import Link from "next/link";
import {
  ArrowLeft,ArrowDownToLine,ArrowUpFromLine,Check,ChevronRight,
  GitCompareArrows,LockKeyhole,RotateCcw,Search,ShieldCheck,ShieldAlert,
} from "lucide-react";
import type {ManualReviewPreview} from "@/lib/obsidian-manual-sync-review";
import VaultIncomingConflictReview from "@/components/vault-incoming-conflict-review";
import type {SyncChoice} from "@/lib/obsidian-sync-plan";
import {
  chooseReviewIntent,reviewIntentOptions,summariseReviewIntents,
  parseManualM2Handoff,MANUAL_M2_HANDOFF_MAX_BYTES,
  serializeManualM4IncomingIntent,serializeManualM3UploadIntent,
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

export default function VaultManualSyncReview({preview:syntheticPreview}:{preview?:ManualReviewPreview}){
  const [manualPreview,setManualPreview]=useState<ManualReviewPreview|null>(null);
  const [importError,setImportError]=useState(false);
  const preview=manualPreview??syntheticPreview;
  const [choices,setChoices]=useState<ReviewIntentSelections>({});
  const [filter,setFilter]=useState<Filter>("all");
  const [query,setQuery]=useState("");
  const [showSummary,setShowSummary]=useState(false);
  const tally=useMemo(()=>preview?summariseReviewIntents(preview,choices):null,[preview,choices]);
  const visible=useMemo(()=>(preview?.decisions??[]).filter(row=>{
    const match=row.slug.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    if(!match)return false;
    if(filter==="review")return row.perNoteConfirmationRequired;
    if(filter==="conflict")return row.choice==="conflict";
    if(filter==="done")return !row.perNoteConfirmationRequired;
    return true;
  }),[preview,filter,query]);

  function choose(slug:string,intent:ReviewIntent){
    if(!preview)return;
    setChoices(before=>chooseReviewIntent(preview,before,slug,intent));
    setShowSummary(false);
  }

  function downloadIntentJson(json:string,filename:string){
    // Browser-local Blob only. This does not transmit note metadata.
    const url=URL.createObjectURL(new Blob([json],{type:"application/json"}));
    const link=document.createElement("a");
    link.href=url;
    link.download=filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function exportIncomingIntent(slug:string){
    if(!manualPreview)return;
    const json=serializeManualM4IncomingIntent(manualPreview,choices,slug);
    downloadIntentJson(json,"naosledge-m4-incoming-"+slug+".json");
  }

  function exportUploadIntent(slug:string){
    if(!manualPreview)return;
    const json=serializeManualM3UploadIntent(manualPreview,choices,slug);
    downloadIntentJson(json,"naosledge-m3-upload-"+slug+".json");
  }

  async function importLocalHandoff(file:File|undefined){
    if(!file)return;
    try{
      if(file.size>MANUAL_M2_HANDOFF_MAX_BYTES){
        throw Error("File too large");
      }
      // Browser-local File.text(): never POST private slugs or fingerprints.
      const reviewed=parseManualM2Handoff(await file.text());
      setManualPreview(reviewed);
      setChoices({});setFilter("all");setQuery("");setShowSummary(false);
      setImportError(false);
    }catch{
      setImportError(true);
      // On failure, never replace an earlier verified display with a partial list.
    }
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
      <span className="vault-sync-demo-label">{manualPreview?"MSI 手動匯入 · 唯讀快照":syntheticPreview?"互動預演 · 合成筆記":"等待 MSI 唯讀快照"}</span>
    </header>

    <div className="vault-sync-notice" role="status">
      <ShieldCheck aria-hidden="true" size={20}/>
      <div>
        <strong>目前不會執行同步。</strong>
        <span>{manualPreview?
          "這是從 MSI 手動匯入的本機快照，不是網站即時連線或身分驗收。快照可能過期；所有選擇只存在本頁記憶體，絕不執行上傳、下載、覆寫、刪除或建立授權。":
          syntheticPreview?"畫面使用虛構資料，沒有讀取真實 Obsidian 筆記或 Neon 內容。所有選擇只保留在本頁記憶體，不會上傳、下載、覆寫、刪除或建立授權。":
          "尚未載入任何筆記。請在 MSI 執行本人授權的 Sandbox 唯讀匯出，再手動選取 JSON；網站不會自行讀取您的電腦或 Neon。"}</span>
      </div>
    </div>

    <div className="vault-sync-notice" role="group" aria-label="手動匯入 MSI Sandbox 唯讀快照">
      <ShieldAlert aria-hidden="true" size={20}/>
      <div>
        <strong>匯入 MSI 產生的唯讀差異快照</strong>
        <span>先在 MSI 執行 Sandbox Owner JWT 唯讀匯出，再在此選擇輸出的 JSON。只於瀏覽器本機解析，不會傳回網站；檔案含私人筆記名稱及 SHA，匯入後請自行清除暫存檔。匯入不是同步授權。</span>
        <label htmlFor="vault-sync-handoff-file">選擇 MSI Sandbox JSON 檔案</label>
        <input id="vault-sync-handoff-file" type="file" accept=".json,application/json"
          onChange={event=>{
            void importLocalHandoff(event.currentTarget.files?.[0]);
            event.currentTarget.value="";
          }}/>
        {manualPreview&&<button type="button" onClick={()=>{
          setManualPreview(null);setChoices({});setQuery("");setFilter("all");
          setShowSummary(false);setImportError(false);
        }}>{syntheticPreview?"清除私人快照並回到合成預演":"移除私人快照"}</button>}
        {importError&&<span role="alert">匯入失敗：不是完整有效的唯讀差異快照，原畫面未更動。</span>}
      </div>
    </div>

    {!preview&&<div className="vault-sync-empty" role="status">
      <strong>尚未匯入 MSI 唯讀快照</strong>
      <p>在 MSI 上手動執行 <code>scripts/obsidian-msi-manual-preview.ts --sandbox-m2-readonly-handoff</code>，以標準輸入提供短效的 Sandbox Owner JWT，產生本機 JSON 後再從上方選擇檔案。請勿將 JWT 貼到網頁、聊天、指令參數或檔案。</p>
      <p>未取得真正的 Sandbox Owner 身分驗證與完整清單時，這裡不顯示任何示例筆記，避免將合成資料誤認為真實結果。</p>
    </div>}

    {preview&&tally&&<>
    {preview.previewStatus==="partial-local-coverage"&&<div className="vault-sync-coverage" role="alert">
      <ShieldAlert aria-hidden="true" size={20}/>
      <div>
        <strong>本機有尚未列入比對的內容。</strong>
        <p>未支援的 Markdown 檔名：{preview.inventory.localUnsupportedMarkdown}；未掃描的資料夾：{preview.inventory.localDirectoriesNotScanned}。
          這些內容不在下方審查清單內，不能視為已同步或可以刪除。</p>
      </div>
    </div>}

    <div className="vault-sync-totals" aria-label="同步差異摘要">
      <div><strong>{preview.decisions.length}</strong><span>{manualPreview?"快照筆記":"示例筆記"}</span></div>
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
      <div className="vault-sync-filters" role="group" aria-label="差異類型篩選">
        {([
          ["all","全部"],["review","待審查"],["conflict","衝突"],["done","無須處理"],
        ] as const).map(([value,label])=>
          <button key={value} type="button" aria-pressed={filter===value}
            onClick={()=>setFilter(value)}>{label}</button>
        )}
      </div>
      <label className="vault-sync-search">
        <Search size={17} aria-hidden="true"/>
        <span className="visually-hidden">搜尋筆記</span>
        <input value={query} onChange={e=>setQuery(e.target.value)}
          type="search" maxLength={120} placeholder="搜尋筆記名稱" aria-label="搜尋筆記"/>
      </label>
    </div>

    <ol className="vault-sync-notes">
      {visible.map(row=>{
        const status=STATUS[row.choice];
        const options=reviewIntentOptions(row.choice);
        const selected=Object.hasOwn(choices,row.slug)?choices[row.slug]:undefined;
        return <li key={row.slug} className="vault-sync-note">
          <div className="vault-sync-note-main">
            <div className="vault-sync-note-id">
              <span className="vault-sync-note-state" data-kind={status.kind}>{status.text}</span>
              <span className="vault-sync-note-slug">{row.slug}.md</span>
            </div>
            <h3>{row.slug}</h3>
            <p>{status.message}</p>
            <dl className="vault-sync-versions">
              <div><dt>Obsidian</dt><dd title={manualPreview?"匯入快照 SHA-256 指紋":"合成資料 SHA-256 指紋"}>{row.expectedLocalSha?.slice(0,10)??"不存在"}</dd></div>
              <div><dt>NaosLedge</dt><dd title={manualPreview?"匯入快照 SHA-256 指紋":"合成資料 SHA-256 指紋"}>{row.expectedRemoteSha?.slice(0,10)??"不存在"}</dd></div>
              <div><dt>遠端版本</dt><dd>{row.expectedRemoteRevision??"不存在"}</dd></div>
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
              {manualPreview&&preview.previewStatus==="ready"&&selected==="upload"&&
                (row.choice==="review-upload"||row.choice==="review-missing-remote")&&
                (row.choice==="review-missing-remote"||
                  /^[0-9a-f]{64}$/.test(row.expectedRemoteRevision??""))&&
                <button type="button" className="vault-sync-intent-export"
                  aria-label={row.slug+" 的 M3 上傳交接 JSON"}
                  onClick={()=>exportUploadIntent(row.slug)}>
                  匯出單篇上傳交接 JSON（不執行）
                </button>}
              {manualPreview&&preview.previewStatus==="ready"&&
                /^[0-9a-f]{64}$/.test(row.expectedRemoteRevision??"")&&
                (selected==="download"||selected==="keep-both")&&
                <button type="button" className="vault-sync-intent-export"
                  aria-label={row.slug+" 的 M4 Incoming 交接 JSON"}
                  onClick={()=>exportIncomingIntent(row.slug)}>
                  匯出單篇 Incoming 交接 JSON（不執行）
                </button>}
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
        {preview.decisions.filter(row=>Object.hasOwn(choices,row.slug)).map(row=><li key={row.slug}>
          <span>{row.slug}.md</span><strong>{INTENT_LABEL[choices[row.slug]]}</strong>
        </li>)}
        {tally.selected===0&&<li>目前沒有任何審查選擇。</li>}
      </ul>
      <p className="vault-sync-final-warning"><ShieldAlert size={18} aria-hidden="true"/>
        這不是同步執行清單，也沒有「批准上傳」效力。離開或重新整理頁面後，選擇會消失；真正操作需在後續 M3／M4 重新核對兩端版本並取得本人確認。</p>
    </section>}
    </>}
    <VaultIncomingConflictReview/>
  </section>;
}
