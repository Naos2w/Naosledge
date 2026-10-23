# NaosLedge × Obsidian — 確認版雙向手動同步 TODO (M1–M7)

更新：2026-10-24；依 Owner 已確認的產品需求及最新隔離實作同步。

## 不得更改的產品契約

- **Obsidian 與 NaosLedge 都是正式編輯入口**，任何一邊編輯都不構成對另一邊的覆寫授權。
- **預設手動觸發，同步前逐篇確認**；沒有自動同步、背景輪詢或自動套用。
- **雙邊修改時保留兩個版本**，不依檔案日期判斷勝負。
- **絕不自動刪除**：單邊缺少檔案、兩邊均缺少但基準仍存在，都不觸發實際刪除或清理基準。
- 私人內容使用站長 Auth + Neon RLS，公開部落格的發布與私人筆記同步獨立。
- 尚未經核准的真實 MSI Vault／Neon Production 寫入一律保持關閉。
- **一般開發不再等待獨立 QA Agent**：由 Developer 實作並執行受影響的單元測試、型別檢查、Build、必要的 UI 測試與 GitHub CI；正式部署或真實資料寫入仍遵守既有安全／授權閘門。

## 最新優先 TODO（2026-10-24）

1. **P0｜M2 合併前檢查**：PR [#27](https://github.com/Naos2w/Naosledge/pull/27) 仍為 Ready、未合併；2026-10-24 已確認前一版本 HEAD `6cd926f` 的 CI #98 SUCCESS。此後每次都應重新檢查 GitHub **最新** HEAD/CI（新 Commit 不沿用舊 SUCCESS）；確認差異及合併授權後才能合入 `main`；**合併不等於部署**。
2. **P1｜真正的 M1 唯讀驗收**：2026-10-24 在真正 MSI 上完成安裝／GUI 註冊及固定路徑唯讀掃描（0 個直接 Markdown、0 個未涵蓋資料夾、0 次寫入）。新增手動工具 `scripts/obsidian-msi-manual-preview.ts`，可從 stdin 一次性取得 Sandbox Owner JWT，先以 `blog_admins` 本人 RLS 列驗明 Owner 身分，再執行真正的 Owner-RLS 筆記 GET（避免非 Owner 收到 200 空清單卻被誤判成功）；**目前尚缺 Sandbox-only 短效 Owner JWT，並未執行真實遠端 GET**。認證失敗、超限或不完整時必須停止；不能把合成 HTTP 測試當作真實驗收。
3. **P1｜M2 真實唯讀預覽接線**：只在受控站長流程顯示差異；保留逐篇選擇、版本資訊與「未涵蓋筆記」警示；不提供任何實際傳輸、刪除或自動執行。**2026-10-24 已加強 M2 合成／未來唯讀預覽的資料完整性驗證**：驗證完整 Inventory、7 類差異計數、SHA／Revision、缺漏警示與逐篇方向一致；錯誤／截斷／矛盾清單一律拒絕。修正合法 slug `constructor` 被 Object 原型屬性錯認為使用者選擇的問題；但實際 Owner JWT／Neon GET 仍未接線，不能稱真實資料審查已完成。
4. **P1｜M3 Sandbox 手動上傳**：已新增**完全隔離的合成上傳預演**（單篇隨機一次性確認、重新讀取本機 SHA 與合成遠端 SHA/revision，建立與更新分開測試、失敗不更新 Baseline）。真實 Neon Sandbox 寫入介面、站長授權整合與 MSI 實際驗收仍**未實作／未授權**，不得直接接到 Production。
5. **P2｜M4/M5**：M4 **合成 Incoming 副本預演已新增**（只在隨機 Scratch 的獨立 Incoming 建檔，支援衝突保留兩份，不修改原稿、不更新 Baseline）；M5 已新增**隨機 Scratch 專用 append-only 成功證據、限量雙版本行比較及唯讀日誌重新載入預檢**。恢復預檢遇到多筆同名歷史、版次變更、兩端差異或記憶體 Baseline 不一致會保守標示、絕不推斷勝者或自動匯入。正式 Vault／Neon 持久化、真正 MSI 下載適配器、跨程序重啟後可信載入及 UI 接線仍待開發／授權；任何刪除仍需另外的明確人工決定。
6. **P2｜M6/M7**：完成 Sandbox 真實 E2E 與回復測試後，另取得 Owner 對正式資料範圍及發布的明確授權；不可為省略 QA 而省略資料安全／發布閘門。

**暫緩**：PR #21–25 安全研究整合、TPM/DPAPI、企業級 AES 備份輪換、強制斷電實驗、Cron 自動同步及自動覆寫。這些不是 M2／M3 一般開發前置條件。

## 正式里程碑

| 階段 | 具體內容 | 可驗收的完成標準 | 當前狀態 |
| --- | --- | --- | --- |
| **M0** | 兩邊皆可編輯、手動逐篇確認、衝突不覆寫、不自動刪除 | Owner 已確認 | **完成** |
| **M1** | 把現有本機 SHA 掃描、Neon Sandbox RLS 唯讀清單，交給同一份差異預覽 | 完整遠端清單才產生預覽；同名初次差異→衝突；缺失、兩邊修改與未覆蓋檔案都可見；M1 完全不寫入 | **已於 PR #26 合併 `main`（Merge SHA `eb3023b1`；PR CI #87 SUCCESS）。離線整合通過；真正 Owner JWT／Neon GET 尚未驗收，不代表正式同步可用；獨立 QA 不再是一般開發前置條件** |
| **M2** | 私人站長審查畫面：上傳、下載、保留兩份、略過；逐篇選擇 | 站長限定、M1 差異卡片、兩端 SHA 短指紋、逐篇選擇、衝突方向限制、摘要、RWD／鍵盤驗收；不執行同步 | **PR #27 Ready、已確認先前 HEAD `6cd926f` 的 CI #98 SUCCESS；未合併／部署，真實資料預覽尚未接線。後續提交需重新驗證最新 CI。詳見 [M2 規格](OBSIDIAN_M2_REVIEW_UI.md)** |
| **M3** | Obsidian → NaosLedge 的逐篇上傳 | 僅允許本人、Sandbox 首驗、建立/更新前重新讀取 SHA/Revision；失敗不更新 Baseline；沒有 DELETE | **合成 Scratch／記憶體遠端的逐篇上傳預演已完成；真正 Auth、Neon Sandbox API、真實內容傳輸待開發／授權，未正式啟用** |
| **M4** | NaosLedge → Obsidian 的逐篇下載 | 先在獨立 Inbox/Incoming 產生新檔；已存在原稿不直接覆寫；本人另行決定如何合併 | **合成 Scratch Incoming 副本預演已實作／測試；真人 Vault 或 Neon Sandbox API 尚未接線／授權** |
| **M5** | 衝突比較與 Baseline 持續記錄 | 僅在已核准成功且已再次確認兩邊內容一致後保存 Baseline；離線、rename、重試不得誤覆寫或清除 | **合成 Scratch 的逐篇 Baseline append-only 證據、唯讀雙版本行比較及唯讀日誌重新載入預檢已實作；衝突保留、還原不清除 Baseline 已驗證。真正可跨程序重啟並驗證來源的持久載入、正式資料層／UI 接線仍待開發** |
| **M6** | 在獨立 Sandbox 做真實 Auth/RLS/API ＋ MSI 測試 | 上傳、下載、同名雙改、部分清單、網路失敗、回復與防刪案例通過，測試資料清理留證據 | 待開發 |
| **M7** | 正式 Vault ↔ Production 受控啟用 | Owner 指定資料範圍／備份位置／逐篇授權、功能及安全驗收、精確發布 SHA 與回復計畫；遵守正式發布閘門，不以一般開發獨立 QA 作額外要求 | 需另行授權 |

## M1 MSI 真人唯讀驗收入口（2026-10-24）

- 已於正式 MSI 機器執行現有的 `npm run verify:obsidian:msi` 和 `npm run verify:obsidian:vault:msi`：Obsidian 已安裝，指定 Vault 的 GUI 註冊驗證通過；支援 Markdown 為 0、未掃描資料夾為 0。這**不是** Neon Owner-RLS GET。
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

## M3 上傳隔離預演（2026-10-24）

- `lib/obsidian-durable-write-sandbox.ts` 已新增 `SyntheticUploadConsent` 與 `approvedUpload()`：只允許從作業系統**新建的隨機暫存 Scratch** 讀合成 Markdown，更新**同一進程內的合成 Remote Map**；無 Neon HTTP、無實際 Obsidian Vault 路徑、無真實 Owner JWT。
- 只有 M1 規劃器回報 `review-upload` 或 `review-missing-remote` 才提供 `uploadConsents`。逐篇授權含亂數 nonce 與 10 分鐘期限，僅一次有效；上傳前及人工介入後再次比對兩端 SHA、遠端 revision，版本變動、雙改衝突與非法方向一律拒絕。
- 合成遠端首次建立與更新皆可單獨驗收；**成功驗證兩端內容相同後**才更新合成 Baseline。失敗不更新 Baseline，不執行 DELETE；此項不代表 Neon Sandbox 真實寫入功能已完成。
- 既有 `consents` 仍只供下載預演，新增的 `uploadConsents` **不能當作 M2 React 選擇、真實寫入授權、API 憑證或正式同步工作清單**。後續仍要補真正的 Owner Auth / RLS + Sandbox E2E，並確認遠端寫入有版本條件與恢復策略。

## M4 Incoming 隔離預演（2026-10-24）

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
- **2026-10-24 M5 重載預檢**：`inspectSyntheticBaselineReload()` 僅在同一隨機 Scratch 重新讀取格式合格的 checkpoint，並與當下合成 Local SHA、Remote SHA/revision 及既有記憶體 Baseline 交叉核對；可標記雙邊吻合、版本過期、Baseline 不同與多筆歷史歧義。UUID 檔名及時間戳**不能作為可信寫入順序**；多筆同名紀錄不選最新，檔案損壞或讀取中變動就拒絕。即使雙邊吻合，日誌也沒有可跨程序認證的簽章／交易順序，因此**只是人工驗證候選、不能自動匯入 Baseline、授權寫入、覆寫、刪除或同步**。14 項 M5 專項測試全數通過；仍需另設可信交易格式與真正跨程序重啟 E2E，才能設計正式持久載入。

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
