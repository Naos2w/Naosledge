"use client";

import {useRef,useState} from "react";
import {GitCompareArrows,ShieldAlert,ShieldCheck} from "lucide-react";
import {
  inspectM4IncomingConflict,type VerifiedIncomingConflict,
} from "@/lib/obsidian-m5-incoming-conflict-review";

/**
 * M5 manual conflict reading only. No API calls, form submission, persistence,
 * credential capture, merging, saving a Baseline or writing either original.
 */
export default function VaultIncomingConflictReview(){
  const [bundle,setBundle]=useState<VerifiedIncomingConflict|null>(null);
  const [error,setError]=useState("");
  const requestId=useRef(0);

  async function load(files:FileList|null){
    const id=++requestId.current;
    setBundle(null);
    setError("");
    try{
      const verified=await inspectM4IncomingConflict(Array.from(files??[]));
      if(requestId.current===id)setBundle(verified);
    }catch{
      if(requestId.current===id){
        setError("匯入失敗：M4 收據、兩份原始 Markdown 副本或 SHA-256 不一致。未載入內容。");
      }
    }
  }

  function clear(){
    ++requestId.current;
    setBundle(null);
    setError("");
  }

  return <section className="vault-sync-conflict-review" aria-labelledby="vault-sync-conflict-title">
    <div className="vault-sync-list-heading">
      <div>
        <span className="section-kicker">03 / M5 CONFLICT REVIEW</span>
        <h2 id="vault-sync-conflict-title">雙版本人工比對</h2>
      </div>
      <span>只在此瀏覽器顯示 · 不提交</span>
    </div>
    <div className="vault-sync-notice">
      <GitCompareArrows size={20} aria-hidden="true"/>
      <div>
        <strong>讀取已由 MSI M4 保留的衝突副本</strong>
        <span>在檔案選擇器中同時選擇同一個 Incoming 目錄的
          <code> incoming-receipt.json</code>、遠端 <code>&lt;slug&gt;.md</code> 與本地
          <code> &lt;slug&gt;--local.md</code>。瀏覽器會在本機驗證兩份完整 SHA-256，
          再以純文字並排顯示。原文不會送往伺服器。</span>
        <label htmlFor="vault-sync-conflict-files">選取三個 M4 檔案（可多選）</label>
        <input id="vault-sync-conflict-files" type="file" multiple
          accept=".json,.md,application/json,text/markdown"
          onChange={event=>{
            void load(event.currentTarget.files);
            event.currentTarget.value="";
          }}/>
        {bundle&&<button type="button" onClick={clear}>清除此頁中的兩份正文</button>}
        {error&&<span role="alert">{error}</span>}
      </div>
    </div>
    {bundle&&<div className="vault-sync-conflict-result" role="region"
      aria-label={bundle.slug+" 的本機雙版本比對"}>
      <p className="vault-sync-conflict-verified"><ShieldCheck size={18} aria-hidden="true"/>
        本地副本驗證通過：{bundle.slug}.md。
        <span>這只證明選取的檔案符合自述收據，並未重新查詢 Neon 或證明曾成功同步。</span>
      </p>
      <div className="vault-sync-conflict-columns">
        <article>
          <h3>Obsidian 暫存副本 <small>{bundle.localSha256.slice(0,12)}</small></h3>
          <pre>{bundle.localMarkdown}</pre>
        </article>
        <article>
          <h3>NaosLedge Incoming <small>{bundle.remoteSha256.slice(0,12)}</small></h3>
          <pre>{bundle.remoteMarkdown}</pre>
        </article>
      </div>
      <p className="vault-sync-conflict-caution"><ShieldAlert size={18} aria-hidden="true"/>
        兩份內容僅供人工閱讀。此頁不會選擇勝出版本、合併、覆寫、刪除、更新 Baseline，
        也不保證目前 Vault 或 Neon 仍是這些版本。請在真正執行任何操作前重新驗證來源。</p>
    </div>}
  </section>;
}
