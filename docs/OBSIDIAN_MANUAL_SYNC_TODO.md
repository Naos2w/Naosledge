# NaosLedge × Obsidian — 確認版雙向手動同步 TODO (M1–M7)

更新：2026-10-26；M1/M2 已完成真實 Neon Integration Sandbox 合成 Owner JWT／RLS → MSI 唯讀掃描／JSON → 本機 Chrome 審查整合驗收。尚未部署 Production。

## 不得更改的產品契約

- **Obsidian 與 NaosLedge 都是正式編輯入口**，任何一邊編輯都不構成對另一邊的覆寫授權。
- **預設手動觸發，同步前逐篇確認**；沒有自動同步、背景輪詢或自動套用。
- **雙邊修改時保留兩個版本**，不依檔案日期判斷勝負。
- **絕不自動刪除**：單邊缺少檔案、兩邊均缺少但基準仍存在，都不觸發實際刪除或清理基準。
- 私人內容使用站長 Auth + Neon RLS，公開部落格的發布與私人筆記同步獨立。
- 尚未經核准的真實 MSI Vault／Neon Production 寫入一律保持關閉。
- **一般開發不再等待獨立 QA Agent**：由 Developer 實作並執行受影響的單元測試、型別檢查、Build、必要的 UI 測試與 GitHub CI；正式部署或真實資料寫入仍遵守既有安全／授權閘門。

## 最新優先 TODO（2026-10-26）

1. **P0｜M1/M2 真實 Sandbox 端到端驗收已通過**：PR #26–#33 已合併 `main`；本輪 PR #34 修正正式審查頁不再預設顯示合成筆記，補上 MSI→Chrome 真實檔案交接測試。**2026-10-26 MSI 實機成功**：Neon Integration Sandbox 暫時合成 Owner JWT／`blog_admins` RLS 驗證、真實 `knowledge_notes` GET（1 篇獨立合成筆記）、Obsidian 本機唯讀掃描（0 篇）、M1 差異判斷、M2 CLI 本機 JSON、Chrome 匯入與選擇「預定下載」均 PASS。無筆記同步、Production 或 Vault 寫入。結束後再次 SQL 驗證 Sandbox 私人筆記、連結、站長授權、Auth 使用者、Auth 帳號全為 0。**限制：M2 網站端驗收使用 localhost Chrome 實際元件／臨時測試路由，不等於正式 Vercel 的真人登入與部署驗收。**
2. **P1｜真正的 M1 唯讀驗收**：2026-10-24 在真正 MSI 上完成安裝／GUI 註冊及固定路徑唯讀掃描（0 個直接 Markdown、0 個未涵蓋資料夾、0 次寫入）。新增手動工具 `scripts/obsidian-msi-manual-preview.ts`，可從 stdin 一次性取得 Sandbox Owner JWT，先以 `blog_admins` 本人 RLS 列驗明 Owner 身分，再執行真正的 Owner-RLS 筆記 GET（避免非 Owner 收到 200 空清單卻被誤判成功）；**2026-10-26 已使用臨時合成 Sandbox Owner JWT 真實執行 Owner-RLS GET 並通過（測試完成即撤銷身分及授權）**。新增 PostgREST `Prefer: count=exact`＋嚴格 `Content-Range`/回傳筆數一致性檢查，避免即使 Owner 驗證成功，伺服器限制筆數或未回傳完整清單時仍誤將空清單／局部清單視為 `fullInventory=true`；缺少精確總數也拒絕預覽。認證失敗、超限或不完整時必須停止；真實 Sandbox Owner-RLS 完整清單已完成一次非空驗收；超限／錯誤清單仍由離線負向測試驗證拒絕行為。
3. **P1｜M2 真實唯讀預覽接線**：私人 `/vault/sync` 現在預設**不顯示合成筆記**，只在本人手動匯入通過完整驗證的 MSI JSON 後顯示差異；保留逐篇選擇、SHA／遠端 Revision 與「未涵蓋筆記」警示；不提供任何實際傳輸、刪除或自動執行。**2026-10-24 已加強 M2 合成／未來唯讀預覽的資料完整性驗證**：驗證完整 Inventory、7 類差異計數、SHA／Revision、缺漏警示與逐篇方向一致；遠端指紋與 Revision 必須成對存在，不能有 SHA 卻缺少 Revision 就讓使用者選擇操作（已新增先失敗後通過的回歸測試）。錯誤／截斷／矛盾清單一律拒絕。修正合法 slug `constructor` 被 Object 原型屬性錯認為使用者選擇的問題；已整合 MSI 人工匯出與 M2 瀏覽器本機匯入，2026-10-26 已使用真正 Sandbox 合成站長 JWT 完成 GET → JSON → MSI Chrome 的非空資料端到端驗收；尚未於正式 Vercel 網站使用真人 Production 站長會話驗收。
4. **P1｜M3 Sandbox 手動上傳**：PR #29 新增固定 Neon Integration Sandbox 的 create-only POST 元件，以及 `scripts/obsidian-m3-sandbox-manual-create.ts --sandbox-scratch-create-only` MSI 人工單篇入口。僅接受 stdin 傳入的**合成／獨立 Scratch 可攜式 Markdown**、短效 Sandbox-only Owner JWT 與 `CREATE SANDBOX <slug>` 明確確認；先驗 Owner RLS 與完整清單，拒絕同名覆寫、PATCH／DELETE，不寫 Baseline，結果不明不得自動重試。輸入不讀真實 Obsidian Vault，也不視 M2 UI 選擇為寫入授權。**離線 HTTP 模擬與 CLI 輸入驗證不等於真正 Neon Sandbox POST 成功**；需 Owner 在本機安全取得短效 JWT 並明確逐篇批准後才可驗收。M3 既有筆記的低階 Sandbox 條件式 PATCH 已新增候選實作：先用 Owner RLS 完整清單驗證審查版本、GET 原 row ID/updated_at、重新讀取本機 SHA，再以同一筆資料庫 PATCH 的 `id + slug + updated_at` 條件避免遠端並行覆寫，成功後再 GET 驗證；任何 0 筆更新、競態或結果不明都不自動重試、也不更新 Baseline。已通過假 HTTP 測試，並已新增 MSI 手動 stdin 更新入口；未進行真正 Sandbox JWT/PATCH 驗收，更不操作真實 Vault。
5. **P2｜M4/M5**：M4 除既有合成 Incoming 副本預演外，PR #30/#32 已合併：固定 Neon Sandbox Owner-RLS 單篇唯讀 GET、重新驗證 SHA/revision、獨立 OS 暫存 Incoming 副本及 MSI 人工單篇入口；目前只通過模擬 HTTP＋真實隨機暫存檔測試，沒有真人 Neon GET 或原稿寫入；M5 已新增**隨機 Scratch 專用 append-only 成功證據、限量雙版本行比較及唯讀日誌重新載入預檢**。恢復預檢遇到多筆同名歷史、版次變更、兩端差異或記憶體 Baseline 不一致會保守標示、絕不推斷勝者或自動匯入。正式 Vault／Neon 持久化、真正 MSI 下載適配器、跨程序重啟後可信載入及 UI 接線仍待開發／授權；任何刪除仍需另外的明確人工決定。
6. **P2｜M6/M7**：新增 `tests/obsidian-m6-synthetic-cross-stage.test.mjs`，先以隨機 Scratch／記憶體 Remote 跨階段回歸 M1 預覽、M2 非執行選擇、M3 逐篇上傳、M4 Incoming 保留雙份、M5 只記錄已驗證一致的 Baseline，以及過期版本／漏掃／不完整清單的 fail-closed 行為。**這不是 Neon 或 MSI 真實 E2E**，仍須另外完成真正 Sandbox Auth／RLS／API＋MSI 測試與回復驗收；M7 正式啟用仍需 Owner 個別授權。

**暫緩**：PR #21–25 安全研究整合、TPM/DPAPI、企業級 AES 備份輪換、強制斷電實驗、Cron 自動同步及自動覆寫。這些不是 M2／M3 一般開發前置條件。

## 正式里程碑

| 階段 | 具體內容 | 可驗收的完成標準 | 當前狀態 |
| --- | --- | --- | --- |
| **M0** | 兩邊皆可編輯、手動逐篇確認、衝突不覆寫、不自動刪除 | Owner 已確認 | **完成** |
| **M1** | 把現有本機 SHA 掃描、Neon Sandbox RLS 唯讀清單，交給同一份差異預覽 | 完整遠端清單才產生預覽；同名初次差異→衝突；缺失、兩邊修改與未覆蓋檔案都可見；M1 完全不寫入 | **已合併 main；2026-10-26 MSI 本機與真實 Neon Sandbox 合成 Owner JWT／RLS／非空 GET 完成 M1 端到端驗收。沒有啟用正式同步或 Production 寫入** |
| **M2** | 私人站長審查畫面：上傳、下載、保留兩份、略過；逐篇選擇 | 站長限定、M1 差異卡片、兩端 SHA／遠端 Revision、逐篇選擇、衝突方向限制、摘要、RWD／鍵盤驗收；不執行同步 | **PR #27/#28/#31 已合併 main；本輪完成實際 Sandbox Owner-RLS GET → MSI JSON → Chrome 獨立檔案匯入／逐篇選擇／清除端到端驗收。正式頁改為空白待匯入；Production 網站真人登入及發布尚未驗收，也未啟用同步。詳見 [M2 規格](OBSIDIAN_M2_REVIEW_UI.md)** |
| **M3** | Obsidian → NaosLedge 的逐篇上傳 | 僅允許本人、Sandbox 首驗、建立/更新前重新讀取 SHA/Revision；失敗不更新 Baseline；沒有 DELETE | **PR #29 已合併 `main`，具備固定 Neon Sandbox create-only POST 與 MSI scratch-only 手動 stdin 入口；模擬 HTTP 單篇建立驗證已通過。既有筆記的條件式 Sandbox PATCH 低階候選元件已通過離線模擬；已新增 MSI 逐篇更新入口；尚無真正 Sandbox JWT／POST／PATCH 驗收、真實 Vault 串接或正式同步授權** |
| **M4** | NaosLedge → Obsidian 的逐篇下載 | 先在獨立 Inbox/Incoming 產生新檔；已存在原稿不直接覆寫；本人另行決定如何合併 | **合成 Scratch Incoming 副本已測試；PR #30 新增固定 Sandbox Owner-RLS 單篇 GET 與獨立 OS Incoming 副本，模擬 HTTP/隨機暫存檔驗證通過；尚無真人 MSI/Neon GET 驗收，不接觸 Obsidian 原稿** |
| **M5** | 衝突比較與 Baseline 持續記錄 | 僅在已核准成功且已再次確認兩邊內容一致後保存 Baseline；離線、rename、重試不得誤覆寫或清除 | **合成 Scratch 的逐篇 Baseline append-only 證據、唯讀雙版本行比較及唯讀日誌重新載入預檢已實作；衝突保留、還原不清除 Baseline 已驗證。真正可跨程序重啟並驗證來源的持久載入、正式資料層／UI 接線仍待開發** |
| **M6** | 在獨立 Sandbox 做真實 Auth/RLS/API ＋ MSI 測試 | 上傳、下載、同名雙改、部分清單、網路失敗、回復與防刪案例通過，測試資料清理留證據 | **合成 M1–M5 跨階段安全回歸已新增；真實 Neon Sandbox＋MSI E2E 仍待開發／授權，不可視為驗收完成** |
| **M7** | 正式 Vault ↔ Production 受控啟用 | Owner 指定資料範圍／備份位置／逐篇授權、功能及安全驗收、精確發布 SHA 與回復計畫；遵守正式發布閘門，不以一般開發獨立 QA 作額外要求 | 需另行授權 |

## M1 MSI 真人唯讀驗收入口（2026-10-24）

- **2026-10-24 M1 遠端唯讀快照一致性**：`previewManualObsidianSync()` 在 Owner-RLS Reader 取得遠端完整清單後，先記錄當次遠端指紋與完整性旗標的不可共用序列化快照；第二次本機唯讀掃描完成後，再確認遠端 Reader 提供的物件沒有被其他 callback 更動。若 SHA、`fullInventory` 或 `numberOfNotes` 被改動，拒絕預覽，不能把已驗證過的清單誤當成目前清單。新增三種確定性模擬測試；**僅是離線邏輯保護，不等於再次讀取真正 Neon，也不授權任何傳輸**。
- **2026-10-24 本輪唯讀預覽參考競態保護**：`previewManualObsidianSync()` 在執行非同步本機與遠端 Reader 前記住 Baseline 的原始指紋，於首次本機讀取後及最終規劃前檢查 Baseline 未變；並對首次本機 Manifest 留下獨立序列化快照，防止 Reader 重用同一可變物件時掩蓋遠端 GET 期間的筆記變更。首次本機指紋不合法即拒絕且不啟動遠端 Owner GET。新增三種離線確定性回歸測試，**不涉及任何真實 Vault／Neon 寫入，也不能替代真正的 Sandbox Owner-RLS 驗收或傳輸前版本重驗**。
- **2026-10-24 M1 Owner-RLS 清單禁止快取**：對固定 Neon Sandbox 的 `blog_admins` Owner 身分 GET 和 `knowledge_notes` 清單 GET 都明確設定 `cache: "no-store"` 及 `Cache-Control: no-store`，防止未來在支援 fetch 快取的執行環境誤用舊的 Owner 授權或筆記清單；合成 HTTP 測試確認兩個請求都使用相同禁快取契約。這只是唯讀請求防護，不等於已取得真正 Sandbox JWT／遠端驗收，也不授權寫入或同步。
- **2026-10-24 M1 遠端 GET 期間本機變更防護**：`previewManualObsidianSync()` 在取得完整 Owner-RLS 遠端清單後，會再次唯讀掃描本機，並比較所有已掃描指紋與未涵蓋內容計數；若遠端請求期間發生本機內容變更、新增未掃描資料夾，或第二次掃描失敗，一律拒絕過期預覽。新增真實合成 FS + 模擬遠端的確定性回歸測試。這不能取代真正傳輸前的雙邊版本重驗，也不是鎖定檔案、Sandbox 真實 GET 或正式同步啟用。
- **本輪本機覆蓋率安全修正**：`lib/obsidian-local-manifest.ts` 不再把 Vault 根目錄的符號連結／Windows junction（例如連到外部 `nested-notes/`）當成一般非筆記檔而錯報 `ready`；若出現任何根目錄連結，直接拒絕唯讀 Inventory，且 M1 不呼叫遠端 Reader。唯讀合成測試覆蓋連結資料夾與預覽 fail-closed；沒有掃描連結目標、寫入或觸發同步。
- **2026-10-26 再驗證**：已於正式 MSI 執行 `npm run verify:obsidian:msi` 與 `npm run verify:obsidian:vault:msi`，Obsidian 安裝及 GUI 註冊正常；支援 Markdown 0、未掃描資料夾 0、cloudComparisonPerformed=false、localWrites=cloudWrites=0。另執行 `npm run verify:obsidian:neon:sandbox:anonymous`，固定 Neon Sandbox 三個資料表均拒絕匿名操作、沒有使用寫入方法。**這仍不是** 真正的 Owner-RLS 遠端 GET。
- `npm run verify:obsidian:m1:sandbox:first-look:msi` 是**手動**、僅限 MSI 的首次無 Baseline 唯讀入口；必須另外加 `--sandbox-first-look-readonly` 旗標，並從 stdin 管線傳入**短效、僅供 Neon Sandbox 的 Owner JWT**。它只呼叫既有固定路徑 Vault 掃描和固定 Neon Sandbox GET，沒有參數式 Vault 路徑、Production URL、寫入、刪除、下載、部署、背景輪詢、Baseline 保存或可執行的審查批准。
- 符合條件的 MSI PowerShell 人工操作方式如下。這個示例僅供經授權真人手動操作，**不可貼上 JWT 到聊天、命令列參數、GitHub 或任何記錄檔，也絕不能改用 Production JWT**：

```powershell
$secret = Read-Host 'Short-lived Sandbox OWNER JWT' -AsSecureString
try {
  [System.Net.NetworkCredential]::new('', $secret).Password | node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-msi-manual-preview.ts --sandbox-first-look-readonly
} finally {
  Remove-Variable secret -ErrorAction SilentlyContinue
}
```

- 終端只輸出筆數、衝突數、未涵蓋數與不允許操作旗標，不會列出 Markdown、slug、SHA 或 JWT。首次 Baseline 為 `[]`，代表「沒有既定同步基準」，**不是同步成功或任何覆寫授權**。沒有有效 Sandbox Owner JWT 時，此項仍列為待驗收，不能宣稱成功。

- **M2 MSI → 站長瀏覽器安全交接**：已合併 #31 的 `--sandbox-m2-readonly-handoff` MSI 單次手動匯出與 #28 的瀏覽器本機 JSON 匯入。MSI 端將通過 Owner-RLS 的快照寫入使用者本機排他建立的臨時 JSON，只輸出路徑；檔案含私人 slug／SHA／revision，不含 Markdown 正文或 JWT，匯入後須由本人清理。此流程尚未取得真正 Sandbox Owner JWT 或真人端到端驗收，且不授權任何同步寫入。

## M3 上傳隔離預演（2026-10-24）

- **2026-10-25 MSI 單篇條件式更新入口（PR #33，尚未真人驗收）**：`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-m3-sandbox-manual-update.ts --sandbox-manual-update-only`，僅接受 MSI 人工 stdin JSON，且恰含 `sandboxOwnerJwt`、`markdown`、`decision`、`typedConfirmation`。Owner 必須使用真實 M1/M2 審查取得的 `review-upload` 決策（完整本地／遠端 SHA 與 revision），提供與本地 SHA 相符的 canonical Markdown，並另行逐篇確認 `UPDATE SANDBOX <slug>`；工具不推造決策，也不能證明輸入決策的來源。JWT 只在本機以短效 Sandbox-only 身分透過 stdin 輸入，不能貼入聊天、argv、env 或日誌。工具重用既有 Owner-RLS／完整清單／原子 CAS PATCH／回讀驗證，不讀寫 Vault、不存 Baseline、不自動重試；失敗可能已寫入 Sandbox，必須本人先檢查。只有離線模擬及 CLI 拒絕測試，真正 JWT/PATCH 驗收仍為 `blocked_needs_owner`。

- **2026-10-24 新增真實 Neon Sandbox API create-only 傳輸元件（尚未真人啟用）**：`lib/obsidian-neon-sandbox-create.ts` 只對固定非正式 Sandbox 執行 Owner-RLS 自身驗證、完整遠端 GET、單篇 POST INSERT、再次完整 GET 驗證 SHA/revision；需單篇 `review-missing-remote`、一致的可攜 Markdown SHA 與另外輸入的 `CREATE SANDBOX <slug>` 確認字串。**傳輸前現在透過 `readMarkdown()` 回呼在 Owner GET 完成後重新讀取本機來源並比對原 M1 SHA**，避免將預覽當時快取的 Markdown 寫入已變動的筆記；既有 `(owner_id,slug)` 唯一限制拒絕並行撞名；無 upsert/PATCH/DELETE、無 Baseline 寫入，失敗不自動重試。`tests/obsidian-m3-neon-sandbox-create.test.mjs` 以模擬 HTTP 驗證實際請求形狀、Owner 閘門和撞名拒絕，**不是 Neon 真實寫入驗收**。現有 Scratch-only 人工 MSI 入口，但未取得短效 Owner JWT、未執行真正 Sandbox POST，仍需真人逐篇授權與完成 M3 update-CAS／復原設計；不得將此低階介面視為正式同步開放。

- **M3 真人驗收操作（尚未執行）**：僅在 MSI 的 PowerShell 7（UTF-8）以**另行製作的合成 Scratch 筆記**操作；此命令會真的對 Neon Sandbox 建立一篇筆記，須逐篇另行確認，切勿傳入真實 Obsidian Vault 原稿或 Production JWT。JWT 與正文僅以 stdin 一次性送入子程序，勿貼到聊天、命令列或 CI。沒有短效 Sandbox Owner JWT 時不要執行：
```powershell
$note = Get-Content -LiteralPath 'C:\\Temp\\naosledge-synthetic-note.md' -Raw -Encoding UTF8
$confirmation = Read-Host 'Type CREATE SANDBOX <slug>'
$secret = Read-Host 'Short-lived Sandbox OWNER JWT' -AsSecureString
try {
  @{ sandboxOwnerJwt = [System.Net.NetworkCredential]::new('', $secret).Password
     markdown = $note; typedConfirmation = $confirmation } |
    ConvertTo-Json -Compress |
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-m3-sandbox-manual-create.ts --sandbox-scratch-create-only
} finally {
  Remove-Variable secret,note,confirmation -ErrorAction SilentlyContinue
}
```
  僅在新建後再 GET 的 SHA/Revision 核對成功時顯示成功；不自動清理、重試、更新 Baseline，也不能視為真正 Vault 雙向同步。

- `lib/obsidian-durable-write-sandbox.ts` 已新增 `SyntheticUploadConsent` 與 `approvedUpload()`：只允許從作業系統**新建的隨機暫存 Scratch** 讀合成 Markdown，更新**同一進程內的合成 Remote Map**；無 Neon HTTP、無實際 Obsidian Vault 路徑、無真實 Owner JWT。
- 只有 M1 規劃器回報 `review-upload` 或 `review-missing-remote` 才提供 `uploadConsents`。逐篇授權含亂數 nonce 與 10 分鐘期限，僅一次有效；上傳前及人工介入後再次比對兩端 SHA、遠端 revision，版本變動、雙改衝突與非法方向一律拒絕。
- 合成遠端首次建立與更新皆可單獨驗收；**成功驗證兩端內容相同後**才更新合成 Baseline。失敗不更新 Baseline，不執行 DELETE；此項不代表 Neon Sandbox 真實寫入功能已完成。
- 既有 `consents` 仍只供下載預演，新增的 `uploadConsents` **不能當作 M2 React 選擇、真實寫入授權、API 憑證或正式同步工作清單**。後續仍要補真正的 Owner Auth / RLS + Sandbox E2E，並確認遠端寫入有版本條件與恢復策略。

## M4 Incoming 隔離預演與固定 Sandbox 讀取（2026-10-24）

- **2026-10-26 M4 低階 Incoming 決策一致性守門**：在 `stageNeonSandboxIncoming()` 本身驗證單篇 M2 `SyncDecision` 必須恰含 6 個規定欄位、合法本地 SHA／遠端 SHA／revision，`review-missing-local` 必須本地 SHA 為 null，`review-download`／`conflict` 必須有與遠端不同的本地 SHA。拒絕偽造衝突、已相同版本、遺漏本地版本與夾帶任意目的地，且在 Owner GET 或建立 Incoming 前拒絕；不再僅倚賴 MSI CLI 已做的同型驗證。新增紅燈→綠燈模擬 HTTP／Scratch 回歸，未執行真正 Neon GET 或任何 Vault 寫入，也未核准正式同步。

- **2026-10-25 M4 MSI 人工暫存下載入口**：新增 `scripts/obsidian-m4-sandbox-manual-incoming.ts --sandbox-scratch-incoming-only`，僅在 MSI 以人工管線輸入短效 Sandbox Owner JWT、單篇 M2 `SyncDecision`（完整兩端 SHA／Revision）、`SAVE SANDBOX INCOMING <slug>` 確認後，呼叫原有固定 Sandbox 逐篇 GET 與驗證。輸入長度限制、拒絕目的地／任意多餘欄位／非法方向、禁止讀寫 Obsidian 原稿；成功僅回報私人 OS 暫存 Incoming 路徑，不建立 Baseline，也不刪除。須由 Owner 自行保護與清理暫存副本；目前只通過離線模擬，不表示真人 JWT/Neon GET 成功。這是手動驗收工具，不是正式 UI 同步執行器。

- **PR #30 低階功能（尚未真人驗收）**：`fetchVerifiedNeonSandboxMarkdown()` 在固定 Neon Sandbox 以短效 Owner JWT 驗證 `blog_admins` 和完整清單，再透過單篇 GET 比對可攜 Markdown SHA-256 與遠端 revision；清單或版本不符即拒絕。`stageNeonSandboxIncoming()` 僅在人工逐篇輸入 `SAVE SANDBOX INCOMING <slug>` 後，於 OS per-user 暫存根目錄新建隨機 Incoming 目錄並以 `wx` 建立副本。只適用 `review-download`、`review-missing-local`、`conflict`；不提供任意目的地、不碰真實 Vault、不覆寫原稿、不更新 Baseline、不刪除。此前只有模擬 HTTP＋隨機暫存檔測試；本輪補上以下 MSI 人工入口，仍未完成真正 Neon GET 驗收或正式的私人暫存檔清理流程。

- `createDurableSyntheticObsidianWorkspace()` 另設**全新隨機 Scratch 下的 `incoming/`**；`preview().incomingConsents` 只針對 `review-download`、`review-missing-local`、`conflict` 提供逐篇亂數、10 分鐘有效確認碼。衝突是 **keep-both 的獨立 Incoming 副本**，不是允許既有 `approvedDownload()` 的覆寫。
- `approvedIncomingDownload()` **只有合成 Remote Map** 作為來源，對本次工廠建立的 `incoming/` 以排他 `wx` 建立唯一名稱的新 Markdown，拒絕危險 slug、舊 SHA/Revision、局部不同、偽造／重放／過期確認碼、被替換的 Incoming 目錄，失敗時不留下已建立的未確認副本。
- 成功下載僅表示「產生一份待人檢視的副本」：**不修改合成原稿、不修改或清理 Baseline、不自動刪除、不產生任何正式同步權限**。其他舊授權一律失效，下一篇需重新預覽。`tests/obsidian-m4-incoming-sandbox.test.mjs` 驗證新檔、衝突、過期版本、檔名、競態與預設拒絕。
- **仍未接入真實 NaosLedge、Neon 或 MSI Obsidian Vault**；`syntheticWorkspacePath` 僅供測試，絕不可把本工廠當正式寫入適配器。真實下載前需完成 Owner／Sandbox 驗收與獨立 Inbox 路徑安全設計。

## M5 Baseline 保留與合成成功證據（2026-10-24）

- `lib/obsidian-durable-write-sandbox.ts` 在**當次隨機 Scratch** 新增 `baseline-journal/`：合成環境每次已批准的上傳、下載或復原，在再次確認兩端 SHA 相同、遠端 revision 未變後，才以新 UUID `.json` **追加**同步成功證據（無 Markdown 正文或憑證）；寫檔前先暫存、再次比對、提交並同步檔案與目錄（Windows 目錄同步僅 best-effort）。無任何正式 Obsidian／Neon 路徑參數，不能用於正式同步。
- `listConfirmedSyntheticBaselines()` 僅供同一 Scratch 唯讀檢驗並嚴格拒絕遭改動或不合法的 checkpoint；**不會將檔案自動匯入 Baseline、重建現有記憶體狀態或觸發同步**。
- 合成 Incoming 僅產生待檢視副本，**不記錄成功同步、不更新 Baseline**。若人工批准的 Restore 導致本機與遠端仍不相同，**保留既有 Baseline** 供重新比較，不得以 `baseline.delete()` 偷清除衝突依據；遠端也一致且重新驗證時才追加新證據。
- `tests/obsidian-m5-baseline-journal-sandbox.test.mjs` 驗證成功附加、一次性授權、復原時衝突保留、不完整或偽造日誌拒絕、Incoming 不變動等。**仍不是正式 Baseline 資料庫**：Scratch 由工廠銷毀且沒有正式持久載入／遷移設計，真正 MSI／Neon Sandbox E2E 與持續保留策略仍待完成。
- **2026-10-24 本輪 M5 唯讀內容比較**：`compareSyntheticConflict()` 僅讀同一隨機 Scratch 中的合成雙邊版本，先確認 M1 決策為 `conflict`、SHA + revision 未過期，並在輸出前再次驗證；行比較保留變更前後脈絡，最多約 86 行、每行最多 160 個 Unicode 字元，額外標註省略行與僅換行格式差異。比較不會發出授權碼、合併、寫入、刪除或更動 Baseline，也不將 Markdown 放入 CI。測試涵蓋一般衝突、版本過期、非衝突、長文節流及 CRLF/LF。**此為合成比較原型，不是實際私人 Vault UI 或 Neon 資料傳輸。**
- **2026-10-24 M5 重載預檢**：`inspectSyntheticBaselineReload()` 僅在同一隨機 Scratch 重新讀取格式合格的 checkpoint，並與當下合成 Local SHA、Remote SHA/revision 及既有記憶體 Baseline 交叉核對；可標記雙邊吻合、版本過期、Baseline 不同與多筆歷史歧義。UUID 檔名及時間戳**不能作為可信寫入順序**；多筆同名紀錄不選最新，檔案損壞或讀取中變動就拒絕。即使雙邊吻合，日誌也沒有可跨程序認證的簽章／交易順序，因此**只是人工驗證候選、不能自動匯入 Baseline、授權寫入、覆寫、刪除或同步**。2026-10-24 再補上**重載結尾重新讀取每份 checkpoint**，不僅比對檔名清單，還拒絕檢查期間同名 JSON 被替換成另一份格式合法但內容不同的紀錄；新增確定性競態測試。M5 專項測試目前 16 項通過（本機驗證）；仍需另設可信交易格式與真正跨程序重啟 E2E，才能設計正式持久載入。
- **2026-10-24 M5 重載末段競態保護**：重新檢查 Journal 後、回傳唯讀預檢結果前，也再次比對所有單份證據筆記的 Local SHA、Remote SHA/Revision 與記憶體 Baseline；防止先前逐篇驗證通過，卻在最後日誌檢查期間變更來源而回傳過期的「兩端吻合」。新增本機、遠端和 Baseline 三種確定性末段競態測試；這不具備真正跨程序交易鎖，仍不授權自動載入或同步。

- **2026-10-24 M5 合成 Checkpoint 格式拒絕**：唯讀日誌讀取器現在只接受 `randomUUID()` 產生的標準小寫 UUID v4 檔名（不再接受任意 36 字元十六進位／連字號排列），並驗證證據 slug 長度為 3–120 字元；在任何 Baseline 恢復預覽之前拒絕造假格式。新增先失敗後修正通過的合成 Scratch 回歸案例，M5 專項測試共 17 項通過。**這仍不是對持久日誌的身分認證、可信排序或正式同步授權**。

## M6 合成跨階段安全回歸（2026-10-24，非真實 E2E）

- `tests/obsidian-m6-synthetic-cross-stage.test.mjs` 把既有 M1 唯讀組合器、M2 審查意圖、M3 合成上傳、M4 Incoming 副本與 M5 唯讀證據檢查串成**單一 Scratch 隔離測試**；模擬 Remote 只存在記憶體，沒有真正 Neon HTTP、Owner JWT、Production、真實 Obsidian Vault 或傳輸授權。
- 整合回歸檢查：M2 選擇不產生寫入；逐篇批准後僅上傳單篇合成筆記；遠端筆記及雙改衝突只在 Incoming 新建副本，不覆寫原稿；Incoming 不更新 Baseline；只有已重新確認兩端內容一致的上傳才留下合成 Checkpoint。
- 另外覆蓋上傳前遠端競態、Incoming 前本機競態、未掃描的巢狀 Markdown、不完整的遠端清單，並確認全部 fail-closed、無刪除或不當成功證據。原有跨階段測試 **4 PASS、0 FAIL**。
- **2026-10-24 本輪追加 M1／M6 離線 HTTP 鏈條**：`fetchVerifiedNeonSandboxOwnerFingerprints()` 強制同一 Sandbox JWT 先通過 `blog_admins` Owner-RLS 自身授權 GET，再取得 `knowledge_notes` 完整唯讀清單；MSI 手動入口改用該不可分割封裝。新增 `tests/obsidian-m6-owner-rls-readonly-chain.test.mjs`（3 項）以假 JWT、模擬 HTTP 與隨機 Scratch 驗證：Owner 成功才產生 M2 非執行選擇；非 Owner 的 `200 + []` 在資料 GET 前拒絕；401／503／截斷 JSON／網路斷線均 fail-closed，無實際傳輸、Baseline 或筆記寫入。**沒有真實 Sandbox Owner JWT、沒有 Neon 網路連線、沒有真實 MSI Vault 操作**，不可宣稱 M1 真實 Owner-RLS 或 M6 E2E 已完成。
- 真正 M6 Sandbox Auth／RLS／API＋MSI E2E、網路失敗復原及資料清理證據仍待完成。

## M1 唯讀整合（本次提供的原型程式碼）

- 核心檔案：`lib/obsidian-manual-sync-review.ts`，使用既有 `planObsidianReconciliation()`，不修改原本分類邏輯。
- 預期由已授權呼叫端明確提供 `readLocal()`、`readRemote()` 和 `baseline`。兩個 reader 可以接已有 `readObsidianLocalManifest()` 和 `fetchNeonSandboxFingerprints()`，但**本模組自己沒有任意目錄路徑、Neon URL、JWT 儲存或寫入入口**。
- 遠端讀取結果必須是 **Neon Sandbox、Owner RLS、GET-only、fullInventory=true**，並且回報筆數與指紋陣列相符，最多 20 筆；若為 401/403、網路錯誤、超量或不完整，**絕不能當作空清單**。
- 本機不支援的 `.md` 檔名與未掃描資料夾，回報 `partial-local-coverage`、非零筆數，不能假裝全 Vault 都已列入。注意既有掃描器的 `directoriesNotScanned` 也可能包含正常的 `.obsidian/`；下一步應精準區分設定資料夾與真正未索引的巢狀筆記，而不是粗暴忽略。
- 輸出僅包含安全 slug、SHA/revision 指紋、分類、計數與 `writeAllowed=false`、`deleteAllowed=false`。**不要把含私人筆記識別資訊的預覽直接放到公開日誌、CI 或匿名頁面。**
- 不持久化 `baseline`。沒有 Baseline 時「同名內容不同」一定視為 conflict，不能推斷哪邊是最新版本。
- `both-removed` 表示兩邊都不存在但 Baseline 曾有資料：只保留檢視結果，不刪除 Baseline，也不自動建立任何刪除計畫。

## 既有程式重用與技術限制

| 既有程式 | 本次的用途 | 邊界 |
| --- | --- | --- |
| `lib/obsidian-local-manifest.ts` | MSI 根目錄 `.md` 唯讀 SHA-256 | 只支援安全英文 slug、250 KiB、最多 500 篇；中文檔名/子資料夾會單獨標記 |
| `lib/obsidian-neon-sandbox-readonly.ts` | 僅固定已核准的 Neon Sandbox Owner-RLS GET 指紋 | 最多 20 篇；超量和不完整即停止；不能改用 Production JWT |
| `lib/obsidian-sync-plan.ts` | 區分 unchanged/upload/download/conflict/missing/both-removed | 純函式，無資料庫和檔案 IO，沒有同步核准權限 |
| `lib/obsidian-markdown.ts` | 共用 .md 序列化格式 | 本機 SHA 和遠端 SHA 必須來自相同可攜位元組表示；轉換格式差異須標為人工檢查 |
| `lib/obsidian-sync-sandbox.ts` | 參考逐篇確認/過期版本拒絕的合成測試 | 原有合成覆寫不能直接用於正式 MSI Vault |

## 測試與下一個開發動作

1. **已完成 MSI 原專案接線驗收的離線部分**：M1 的 19 項定向測試包含完整 Reader 鏈條（真實 FS 掃描＋真實 Neon GET Reader，使用合成 HTTP 回應），18 PASS、1 項非 Windows 專用拒絕測試依設計 SKIP。仍不代表已用真實 Owner JWT 呼叫 Neon Sandbox。
2. **已在正常的 OpenChatX 專案權限下建立 `feat/obsidian-manual-sync-review-20261023`** 並套用 M1 原型與測試，與 PR #25 的加密研究分支隔離；前次 Git 建分支拒絕在重新核對後以同一工具正常執行成功。
3. 固定 MSI 接線函式已加入正式產品分支並通過靜態保護測試；**真正 MSI GUI 註冊讀取和 Neon Owner JWT／GET 尚未直接以 M1 組合器執行**。下一步要以審查過的安全入口與經授權 Sandbox 身分執行唯讀驗收，不能使用 Production JWT。
4. M1 已合併 `main`，但不得把 GitHub CI 或合併視為真正的 Owner Sandbox GET 驗收。使用者已確認一般開發不需要獨立 QA，不再因此阻擋 M2/M3；M2 合成 UI 及 MSI 瀏覽器驗收已完成於 PR #27，但真實 Vault/Production 操作及真正上下載仍屬後續受控工作。

## 暫停擴充項目

暫不擴充 TPM/DPAPI 生產金鑰保護、企業級 AES 備份、強制斷電實驗、背景 Cron、全面自動覆寫；保留 PR #21–25 的既有研究成果供後續參考，不設為 M1–M4 功能前置條件。

## M1 獨立整合包 v2（2026-10-23）

- 加入 `lib/obsidian-manual-sync-approved-msi.ts`：只有 MSI Windows 裝置、正式已核准 Vault 註冊一致，才允許建立**一次性唯讀預覽**；只使用固定 Neon Sandbox 分支、固定路徑的原有 RLS GET Reader，沒有 CLI、UI、排程、寫入或憑證保存。
- 加入 `tests/obsidian-manual-sync-approved-msi.test.mjs`：在非 MSI 環境驗證裝置拒絕和純靜態固定讀取接線。**沒有冒充在 MSI 上測試成功**。
- 加入 `tests/obsidian-manual-sync-synthetic-integration.test.mjs`：在容器上使用真實 Node `fs` 掃描合成 `.md`，遠端則使用**模擬的 Owner-RLS 正式形狀清單**；驗證上／下傳預覽、雙改衝突、中文檔名／未掃描資料夾警示、遠端異常不當作刪除。
- M1 baseline 先驗證再讀取任何 Reader；資料不合法立即拒絕。
- v2 獨立測試 17/17 已通過；後續經允許的 Git 分支建立已成功，**已於 MSI 原始碼整合並完成 19 項定向測試（18 PASS／1 OS 特定 SKIP）**，實際 Neon Sandbox Owner GET、獨立 QA 與 Production 同步仍未執行。
