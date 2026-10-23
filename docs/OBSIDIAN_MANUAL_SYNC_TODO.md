# NaosLedge × Obsidian — 確認版雙向手動同步 TODO (M1–M7)

更新：2026-10-23；依 Owner 已確認的產品需求定稿。

## 不得更改的產品契約

- **Obsidian 與 NaosLedge 都是正式編輯入口**，任何一邊編輯都不構成對另一邊的覆寫授權。
- **預設手動觸發，同步前逐篇確認**；沒有自動同步、背景輪詢或自動套用。
- **雙邊修改時保留兩個版本**，不依檔案日期判斷勝負。
- **絕不自動刪除**：單邊缺少檔案、兩邊均缺少但基準仍存在，都不觸發實際刪除或清理基準。
- 私人內容使用站長 Auth + Neon RLS，公開部落格的發布與私人筆記同步獨立。
- 尚未經核准的真實 MSI Vault／Neon Production 寫入一律保持關閉。
- **一般開發不再等待獨立 QA Agent**：由 Developer 實作並執行受影響的單元測試、型別檢查、Build、必要的 UI 測試與 GitHub CI；正式部署或真實資料寫入仍遵守既有安全／授權閘門。

## 最新優先 TODO（2026-10-23）

1. **P0｜M2 合併前檢查**：PR [#27](https://github.com/Naos2w/Naosledge/pull/27) 為 Ready、未合併；最新 HEAD `ebc46f992db4475ddeb34b9e6c55a998a4ac40ef`，CI #91 SUCCESS。確認分支未移動與實際差異後，獲准執行合併時合入 `main`；**合併不等於部署**。
2. **P1｜真正的 M1 唯讀驗收**：以核准的 MSI Vault + 真正 Neon Sandbox Owner-RLS GET 取得完整指紋清單，認證失敗、超限或不完整時必須停止；此步不需一般開發 QA，但不能把合成 HTTP 測試當作真實驗收。
3. **P1｜M2 真實唯讀預覽接線**：只在受控站長流程顯示差異；保留逐篇選擇、版本資訊與「未涵蓋筆記」警示；不提供任何實際傳輸、刪除或自動執行。
4. **P1｜M3 Sandbox 手動上傳**：按篇批准、每次重讀來源/遠端 SHA 與 revision，初次建立與更新分開測試；不得直接接到 Production。
5. **P2｜M4/M5**：先建立不覆寫原稿的 Incoming 下載副本，再做衝突比較與持久 Baseline；任何刪除仍需另外的明確人工決定。
6. **P2｜M6/M7**：完成 Sandbox 真實 E2E 與回復測試後，另取得 Owner 對正式資料範圍及發布的明確授權；不可為省略 QA 而省略資料安全／發布閘門。

**暫緩**：PR #21–25 安全研究整合、TPM/DPAPI、企業級 AES 備份輪換、強制斷電實驗、Cron 自動同步及自動覆寫。這些不是 M2／M3 一般開發前置條件。

## 正式里程碑

| 階段 | 具體內容 | 可驗收的完成標準 | 當前狀態 |
| --- | --- | --- | --- |
| **M0** | 兩邊皆可編輯、手動逐篇確認、衝突不覆寫、不自動刪除 | Owner 已確認 | **完成** |
| **M1** | 把現有本機 SHA 掃描、Neon Sandbox RLS 唯讀清單，交給同一份差異預覽 | 完整遠端清單才產生預覽；同名初次差異→衝突；缺失、兩邊修改與未覆蓋檔案都可見；M1 完全不寫入 | **已於 PR #26 合併 `main`（Merge SHA `eb3023b1`；PR CI #87 SUCCESS）。離線整合通過；真正 Owner JWT／Neon GET 尚未驗收，不代表正式同步可用；獨立 QA 不再是一般開發前置條件** |
| **M2** | 私人站長審查畫面：上傳、下載、保留兩份、略過；逐篇選擇 | 站長限定、M1 差異卡片、兩端 SHA 短指紋、逐篇選擇、衝突方向限制、摘要、RWD／鍵盤驗收；不執行同步 | **PR #27 Ready、CI #91 SUCCESS，最新 HEAD `ebc46f9`，仍未合併／部署；合成 M2 UI 與 MSI Chrome 驗證已通過，真實資料預覽尚未接線。詳見 [M2 規格](OBSIDIAN_M2_REVIEW_UI.md)** |
| **M3** | Obsidian → NaosLedge 的逐篇上傳 | 僅允許本人、Sandbox 首驗、建立/更新前重新讀取 SHA/Revision；失敗不更新 Baseline；沒有 DELETE | 待開發 |
| **M4** | NaosLedge → Obsidian 的逐篇下載 | 先在獨立 Inbox/Incoming 產生新檔；已存在原稿不直接覆寫；本人另行決定如何合併 | 待開發 |
| **M5** | 衝突比較與 Baseline 持續記錄 | 僅在已核准成功且已再次確認兩邊內容一致後保存 Baseline；離線、rename、重試不得誤覆寫或清除 | 待開發 |
| **M6** | 在獨立 Sandbox 做真實 Auth/RLS/API ＋ MSI 測試 | 上傳、下載、同名雙改、部分清單、網路失敗、回復與防刪案例通過，測試資料清理留證據 | 待開發 |
| **M7** | 正式 Vault ↔ Production 受控啟用 | Owner 指定資料範圍／備份位置／逐篇授權、功能及安全驗收、精確發布 SHA 與回復計畫；遵守正式發布閘門，不以一般開發獨立 QA 作額外要求 | 需另行授權 |

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
