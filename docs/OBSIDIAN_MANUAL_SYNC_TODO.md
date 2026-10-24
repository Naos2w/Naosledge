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

1. **P0｜已合併里程碑及待整合 PR**：2026-10-24 PR #26（M1）及 [#27](https://github.com/Naos2w/Naosledge/pull/27)（M2）均已合併；目前 `origin/main` 為 `a192aa3e7af04b5c7bb0df34bc108799ddd7fb83`。後續不得再對 #27 提交。PR [#28](https://github.com/Naos2w/Naosledge/pull/28)（M2 MSI JSON 唯讀匯入，HEAD `a5f583e`，CI #115 SUCCESS）及 [#29](https://github.com/Naos2w/Naosledge/pull/29)（M3 Sandbox create-only，HEAD `c4425467`，CI #117 SUCCESS）仍為 OPEN；兩者 skipped 的舊 CI 不算通過。每個後續 PR 都必須針對當次 HEAD 確認 CI 和獨立合併核准。當前 Project 權限不包括 Merge／Production 部署。
2. **P1｜真正的 M1 唯讀驗收**：2026-10-24 在真正 MSI 上完成安裝／GUI 註冊及固定路徑唯讀掃描（0 個直接 Markdown、0 個未涵蓋資料夾、0 次寫入）。新增手動工具 `scripts/obsidian-msi-manual-preview.ts`，可從 stdin 一次性取得 Sandbox Owner JWT，先以 `blog_admins` 本人 RLS 列驗明 Owner 身分，再執行真正的 Owner-RLS 筆記 GET（避免非 Owner 收到 200 空清單卻被誤判成功）；**目前尚缺 Sandbox-only 短效 Owner JWT，並未執行真實遠端 GET**。新增 PostgREST `Prefer: count=exact`＋嚴格 `Content-Range`/回傳筆數一致性檢查，避免即使 Owner 驗證成功，伺服器限制筆數或未回傳完整清單時仍誤將空清單／局部清單視為 `fullInventory=true`；缺少精確總數也拒絕預覽。認證失敗、超限或不完整時必須停止；目前僅已通過離線模擬驗證，不能當成真實 Sandbox GET 成功。
3. **P1｜M2 真實唯讀預覽接線**：只在受控站長流程顯示差異；保留逐篇選擇、版本資訊與「未涵蓋筆記」警示；不提供任何實際傳輸、刪除或自動執行。**2026-10-24 已加強 M2 合成／未來唯讀預覽的資料完整性驗證**：驗證完整 Inventory、7 類差異計數、SHA／Revision、缺漏警示與逐篇方向一致；遠端指紋與 Revision 必須成對存在，不能有 SHA 卻缺少 Revision 就讓使用者選擇操作（已新增先失敗後通過的回歸測試）。錯誤／截斷／矛盾清單一律拒絕。修正合法 slug `constructor` 被 Object 原型屬性錯認為使用者選擇的問題；但實際 Owner JWT／Neon GET 仍未接線，不能稱真實資料審查已完成。
4. **P1｜M3 Sandbox 手動上傳**：既有合成逐篇上傳預演仍為離線測試；未合併的 PR #29 已新增固定 Neon Sandbox 的 create-only POST 傳輸元件（Owner-RLS 驗證、單篇確認、寫後唯讀重驗、禁止覆寫／刪除），但**只有模擬 HTTP 通過**，沒有 MSI 人工操作入口、真正 Owner JWT／Neon POST 驗收，更新既有筆記的 CAS 也尚未實作。不得將 PR #29 當成已啟用的實際同步。
5. **P2｜M4/M5**：本分支在原有合成 Incoming 預演之外，新增 **M4 真實 Neon Sandbox Owner-RLS 單篇版本重驗 GET → 獨立 OS 暫存 Incoming 副本**的低階元件：逐篇明確確認、檢查 SHA/Revision、衝突保留原稿、不更新 Baseline；目前只有模擬 HTTP＋真實隨機暫存檔驗證，**尚無 MSI 人工入口、真實 Owner JWT 或 Neon GET 驗收**。M5 的合成 append-only 日誌、衝突比較及重載預檢不變；正式 Vault／Production、可信跨程序 Baseline 與 UI 接線仍待開發／另外授權。
6. **P2｜M6/M7**：新增 `tests/obsidian-m6-synthetic-cross-stage.test.mjs`，先以隨機 Scratch／記憶體 Remote 跨階段回歸 M1 預覽、M2 非執行選擇、M3 逐篇上傳、M4 Incoming 保留雙份、M5 只記錄已驗證一致的 Baseline，以及過期版本／漏掃／不完整清單的 fail-closed 行為。**這不是 Neon 或 MSI 真實 E2E**，仍須另外完成真正 Sandbox Auth／RLS／API＋MSI 測試與回復驗收；M7 正式啟用仍需 Owner 個別授權。

**暫緩**：PR #21–25 安全研究整合、TPM/DPAPI、企業級 AES 備份輪換、強制斷電實驗、Cron 自動同步及自動覆寫。這些不是 M2／M3 一般開發前置條件。

## 正式里程碑

| 階段 | 具體內容 | 可驗收的完成標準 | 當前狀態 |
| --- | --- | --- | --- |
| **M0** | 兩邊皆可編輯、手動逐篇確認、衝突不覆寫、不自動刪除 | Owner 已確認 | **完成** |
| **M1** | 把現有本機 SHA 掃描、Neon Sandbox RLS 唯讀清單，交給同一份差異預覽 | 完整遠端清單才產生預覽；同名初次差異→衝突；缺失、兩邊修改與未覆蓋檔案都可見；M1 完全不寫入 | **已於 PR #26 合併 `main`（Merge SHA `eb3023b1`；PR CI #87 SUCCESS）。離線整合通過；真正 Owner JWT／Neon GET 尚未驗收，不代表正式同步可用；獨立 QA 不再是一般開發前置條件** |
| **M2** | 私人站長審查畫面：上傳、下載、保留兩份、略過；逐篇選擇 | 站長限定、M1 差異卡片、兩端 SHA 短指紋、逐篇選擇、衝突方向限制、摘要、RWD／鍵盤驗收；不執行同步 | **PR #27 已合併 main（2026-10-24；`a192aa3e`），仍未部署；M2 MSI 唯讀 JSON 手動匯入接線在獨立 PR #28 待整合，真實 Owner-RLS GET 尚未驗收。詳見 [M2 規格](OBSIDIAN_M2_REVIEW_UI.md)** |
| **M3** | Obsidian → NaosLedge 的逐篇上傳 | 僅允許本人、Sandbox 首驗、建立/更新前重新讀取 SHA/Revision；失敗不更新 Baseline；沒有 DELETE | **合成預演通過；PR #29 的 create-only Neon Sandbox API 元件已完成模擬 HTTP 驗證、尚未合併／真人啟用，真正 MSI 操作入口及既有筆記 CAS 更新仍待開發** |
| **M4** | NaosLedge → Obsidian 的逐篇下載 | 先在獨立 Inbox/Incoming 產生新檔；已存在原稿不直接覆寫；本人另行決定如何合併 | **本分支新增固定 Sandbox 單篇 GET 與獨立 OS 暫存 Incoming 副本；離線 HTTP 模擬＋真實暫存目錄測試通過，尚未接 MSI 人工入口或執行真正 Neon GET，不接觸 Obsidian 原稿** |
| **M5** | 衝突比較與 Baseline 持續記錄 | 僅在已核准成功且已再次確認兩邊內容一致後保存 Baseline；離線、rename、重試不得誤覆寫或清除 | **合成 Scratch 的逐篇 Baseline append-only 證據、唯讀雙版本行比較及唯讀日誌重新載入預檢已實作；衝突保留、還原不清除 Baseline 已驗證。真正可跨程序重啟並驗證來源的持久載入、正式資料層／UI 接線仍待開發** |
| **M6** | 在獨立 Sandbox 做真實 Auth/RLS/API ＋ MSI 測試 | 上傳、下載、同名雙改、部分清單、網路失敗、回復與防刪案例通過，測試資料清理留證據 | **合成 M1–M5 跨階段安全回歸已新增；真實 Neon Sandbox＋MSI E2E 仍待開發／授權，不可視為驗收完成** |
| **M7** | 正式 Vault ↔ Production 受控啟用 | Owner 指定資料範圍／備份位置／逐篇授權、功能及安全驗收、精確發布 SHA 與回復計畫；遵守正式發布閘門，不以一般開發獨立 QA 作額外要求 | 需另行授權 |

## M1 MSI 真人唯讀驗收入口（2026-10-24）

- **2026-10-24 M1 遠端唯讀快照一致性**：`previewManualObsidianSync()` 在 Owner-RLS Reader 取得遠端完整清單後，先記錄當次遠端指紋與完整性旗標的不可共用序列化快照；第二次本機唯讀掃描完成後，再確認遠端 Reader 提供的物件沒有被其他 callback 更動。若 SHA、`fullInventory` 或 `numberOfNotes` 被改動，拒絕預覽，不能把已驗證過的清單誤當成目前清單。新增三種確定性模擬測試；**僅是離線邏輯保護，不等於再次讀取真正 Neon，也不授權任何傳輸**。
- **2026-10-24 本輪唯讀預覽參考競態保護**：`previewManualObsidianSync()` 在執行非同步本機與遠端 Reader 前記住 Baseline 的原始指紋，於首次本機讀取後及最終規劃前檢查 Baseline 未變；並對首次本機 Manifest 留下獨立序列化快照，防止 Reader 重用同一可變物件時掩蓋遠端 GET 期間的筆記變更。首次本機指紋不合法即拒絕且不啟動遠端 Owner GET。新增三種離線確定性回歸測試，**不涉及任何真實 Vault／Neon 寫入，也不能替代真正的 Sandbox Owner-RLS 驗收或傳輸前版本重驗**。
- **2026-10-24 M1 Owner-RLS 清單禁止快取**：對固定 Neon Sandbox 的 `blog_admins` Owner 身分 GET 和 `knowledge_notes` 清單 GET 都明確設定 `cache: "no-store"` 及 `Cache-Control: no-store`，防止未來在支援 fetch 快取的執行環境誤用舊的 Owner 授權或筆記清單；合成 HTTP 測試確認兩個請求都使用相同禁快取契約。這只是唯讀請求防護，不等於已取得真正 Sandbox JWT／遠端驗收，也不授權寫入或同步。
- **2026-10-24 M1 遠端 GET 期間本機變更防護**：`previewManualObsidianSync()` 在取得完整 Owner-RLS 遠端清單後，會再次唯讀掃描本機，並比較所有已掃描指紋與未涵蓋內容計數；若遠端請求期間發生本機內容變更、新增未掃描資料夾，或第二次掃描失敗，一律拒絕過期預覽。新增真實合成 FS + 模擬遠端的確定性回歸測試。這不能取代真正傳輸前的雙邊版本重驗，也不是鎖定檔案、Sandbox 真實 GET 或正式同步啟用。
- **本輪本機覆蓋率安全修正**：`lib/obsidian-local-manifest.ts` 不再把 Vault 根目錄的符號連結／Windows junction（例如連到外部 `nested-notes/`）當成一般非筆記檔而錯報 `ready`；若出現任何根目錄連結，直接拒絕唯讀 Inventory，且 M1 不呼叫遠端 Reader。唯讀合成測試覆蓋連結資料夾與預覽 fail-closed；沒有掃描連結目標、寫入或觸發同步。
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

## M4 Incoming 隔離預演與固定 Sandbox 讀取（2026-10-24）

- **本分支實作（尚未真實驗收）**：`fetchVerifiedNeonSandboxMarkdown()` 先用固定 Sandbox URL 及短效 Owner JWT 依序驗證 `blog_admins` 授權、完整 `knowledge_notes` 清單，並以額外單篇 GET 比對整篇可攜 Markdown 的 SHA-256 與遠端 Revision；任何資料變動／部分回應就拒絕。只有 `review-download`、`review-missing-local`、`conflict` 加上逐篇 `SAVE SANDBOX INCOMING <slug>` 明確確認，才可透過 `stageNeonSandboxIncoming()` 於 OS per-user 暫存根目錄新建隨機 Incoming 目錄、以 `wx` 產生單一 Markdown 副本；**不接受任意目的地、不開啟實際 Vault、不覆寫、不更新 Baseline、不刪除**。目前模擬 HTTP＋真實隨機暫存檔驗證，並未取得真人 Sandbox Owner JWT、執行真正 Neon GET 或新增真人 MSI 呼叫入口；實際使用前仍需驗收、人工操作者流程與隱私目錄清理策略。

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
