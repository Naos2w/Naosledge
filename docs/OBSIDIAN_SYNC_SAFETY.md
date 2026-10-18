# Naosledge × Obsidian 雙向同步 — 安全預演核心（未啟用）

更新：2026-10-18。

這份文件說明 `lib/obsidian-sync-plan.ts` 的**純函式衝突判定器**。它只處理合成或授權來源產生的 `slug + SHA-256 + 可選 revision` 指紋清單，並產生可供人員審閱的預演結果。

目前已新增 **限縮根目錄、純唯讀的本地指紋掃描**，只操作 Owner 核准的 MSI 空白路徑或合成暫存資料夾，不遞迴、不寫入。仍**沒有** Neon Production API 存取、遠端同步、檔案上傳／下載、寫入、排程或背景常駐程序。它不是 Obsidian 官方同步服務。

## 三份最小清單

| 名稱 | 意義 |
|---|---|
| Local | Obsidian 本機清單（未接入本機資料夾） |
| Remote | Naosledge 私人筆記清單（未啟用實際 Neon 讀取） |
| Baseline | 上次成功同步後兩邊相同的內容指紋；沒有 Baseline 不猜哪一邊較新 |

每筆目前僅支援 `slug`（安全的英數連字號，最多 120 字）、`sha256`（64 個小寫十六進位字元）以及可選 `revision`（最多 128 字元的安全版本識別碼）。每個清單最多 500 筆；重複 slug、`../`、任意檔案路徑、原始 Markdown、`owner_id` 與憑證欄位會被拒絕。這不是正式同步傳輸格式的最終承諾。

## MSI 端限縮式唯讀掃描（已實作）

新增 `lib/obsidian-local-manifest.ts`：只能掃描**傳入資料夾的直接子項**，不遞迴，不進入 `.obsidian`、附件／其他目錄。只有小寫 ASCII slug、最多 120 字的 `*.md` 可以產生 SHA-256 指紋；遇到硬連結、符號連結、路徑重新導向、非普通檔案、超過 250 KB、掃描期間內容變動或超過 500 個 Markdown 檔案會拒絕，而不是嘗試自動修復或同步。中文／空格檔名會**計數並等待手動對應**，不會自動改名或忽略成已完成同步。

`npm run verify:obsidian:vault:msi` 固定鎖定已獲核准的 `C:\Naos\Obsidian\Naosledge`，也鎖定 Windows 電腦名稱 `MSI`。工具只回報檔案數量、忽略項目數、`cloudWrites=0`、`localWrites=0` 和 `automaticSyncEnabled=false`，**不會印出 SHA、私人 Markdown 正文或筆記檔名**。合成資料測試全部寫進 OS 暫存目錄，測試完成後清理。

此掃描不會自動從 Neon 取得遠端 manifest、保存 baseline 或執行任何同步計畫；`lib/obsidian-sync-plan.ts` 仍是需要人工確認的純函式。

## 安全處理矩陣

| 偵測到的情況 | 預演結果 | 允許自動寫入？ |
|---|---|---|
| 兩邊 SHA 相同 | unchanged | 否，無須寫入 |
| 本機變更，雲端仍與 Baseline 相同 | review-upload | 否，需人工同意與版本再確認 |
| 雲端變更，本機仍與 Baseline 相同 | review-download | 否，需人工同意與檔案備份 |
| 雙方均修改且不同 | conflict | 否，須人工處理，不用較新時間直接覆蓋 |
| 任一方缺少檔案 | review-missing-* | 否，不能推斷使用者想刪除 |
| 兩方均不存在、Baseline 曾存在 | both-removed | 否，不做任何刪除或上傳 |
| 首次同步同名但正文不同 | conflict | 否，不能臆測哪份正確 |

**所有預演結果 `autoApplyAllowed=false`**。即使只在一邊變更，仍須授權後才可由未來的執行器寫入。防止因 Obsidian rename／移動、Neon API 暫時性錯誤、行動裝置離線及寫入競爭造成無法復原的損失。

## 未來執行器必須額外具備

- **明確範圍：**由 Owner 指定哪台 Windows 電腦、Obsidian Vault 的實際資料夾；確認手機是否需雙向同步。絕不掃描根目錄、其他專案或系統資料。
- **沙盒試跑：**先在合成資料夾與 Neon Sandbox 走完上傳、下載、修改、衝突、rename、離線等流程，不直接測試正式私人內容。
- **安全寫入：**逐篇確認修改計畫；compare-and-swap 比對 SHA／Remote revision；落地前備份既有檔案並採原子寫入；Neon 一律用 Owner 本人的 Auth JWT 與 RLS。
- **隱私：**認證資料只存在安全加密儲存，不進 GitHub／CLI logs。正式私人 Markdown 永不傳送到未授權的 AI 模型或第三方供應商。
- **成本與排程：**預設手動啟動、無常駐進程／Cron。是否允許定期同步、時間間隔及資源成本由 Owner 確認後才啟用。

## 離線驗證

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/obsidian-sync-plan.test.mjs
npm run test:unit
npm run typecheck
```

測試含 11 種零網路情境：單邊修改、雙邊衝突、缺失／刪除保護、首次同步、相同 SHA、重複／不安全 slug、惡意路徑及私人欄位拒絕、排序決定性與 500 筆容量上限。

**仍需 Owner 協助：**實際 Obsidian Vault 的位置、打算同步的裝置、是否允許修改現有檔案、衝突與刪除政策。取得前只完成預演引擎，絕不宣稱雙向同步已就緒。
