# Obsidian 正式同步寫入防護：逐篇確認、磁碟備份與手動復原

更新：2026-10-20。本文件記錄 **正式同步檔案安全機制的實作與合成驗證**，但**沒有啟用** MSI 正式 Vault 與 Neon Production 的雙向寫入。此次 Owner 只核准開發與隔離合成測試，Production 實測必須再取得獨立授權。

## 已完成的實作

`lib/obsidian-durable-write-sandbox.ts` 實作可在 Windows MSI 執行的 TypeScript 檔案寫入防護，所有可寫路徑都限制為函式自己在系統 TEMP 目錄下以亂數建立的 `naosledge-durable-synthetic-only-*` 專屬資料夾；**程式沒有接受外部資料夾路徑的參數**、沒有 Neon API、沒有 Auth、沒有自動刪除筆記，也沒有背景排程。

- **先預覽、再逐篇確認：** 透過既有的三方差異比對，只有 `review-download`／`review-missing-local` 可以取得確認碼。確認碼包含筆記 slug、獨立 nonce、10 分鐘有效期限。任何新預覽、成功處理或過期都不能重複使用先前確認碼。
- **內容與版本綁定：** 每篇核對本機 SHA-256、合成遠端 SHA-256、revision。預覽後任一方更動、任一方內容缺少、雙方衝突，都直接拒絕覆寫。外部修改偵測不依賴時間戳判定「較新方」。
- **磁碟備份：** 當覆寫已存在的合成檔案，先以 exclusive-create／使用者檔案權限寫入 `backups/<uuid>.bak` 和 `.json` 紀錄；保留覆寫前 SHA、覆寫後預期 SHA、筆記 slug、建立時間與備份識別碼。兩個檔案都執行檔案 fsync，**先完成備份才允許進行 staged rename**；如果流程中途失敗，備份仍留在暫存沙盒供檢查，不會偷偷清除備份。
- **建立新檔禁止覆寫：** 新檔採 exclusive-create；如果預覽後另一個程序新增同名檔案，操作會失敗，而不是蓋掉新檔。
- **同步程序間互斥：** `locks/<slug>.lock` 透過 exclusive-create 避免本工具多個同步程序同時處理同一篇。崩潰後遺留的 lock 不會被自動暴力清除；需要人工檢查。
- **復原同樣要重新確認：** 使用者先查看備份，另行產生 `CONFIRM RESTORE ...`，只在現有筆記 SHA 還等於被覆寫後的預期值時才能復原。**復原操作前又會先備份當前版本**，使復原本身亦可撤銷。
- **拒絕危險路徑：** 小寫 slug、250KB 大小上限、符號連結與硬連結拒絕，限制在單一由工具自行建立的隔離資料夾，並於所有測試完成後明確刪除合成測試環境。
- **操作不自動執行：** 只有測試腳本明確傳入逐篇批准才能進行寫入；`preview()` 本身不觸發任何傳輸。
- **P0 不覆寫原稿的待檢視副本（2026-10-20）：** `preview()` 對 `conflict`、`review-download`、`review-missing-local` 另行產生 `stageConsents`，確認格式為 `CONFIRM STAGE <slug> <nonce>`。透過 `approvedStageIncoming()` 在**合成沙盒**獨立 `incoming/` 以 UUID 檔名、`O_EXCL`、檔案 fsync 建立遠端快照，絕不透過 rename／覆寫 `notes/<slug>.md`，不推進同步 baseline、不產生原稿備份（因為完全不修改原稿）。本路徑有獨立一次性／10 分鐘授權，同一輪預覽的 Stage 和 Download 不可重複使用；複本產生前後都核對來源修訂與本機指紋，若變更則拒絕並刪除當次新建的合成副本。此機制供日後非破壞性衝突檢視設計，不代表真正的 Windows CAS 已實現。

## 只限合成資料的 MSI 操作指令

```powershell
# 只預覽，不寫入任何真實筆記
npm run verify:obsidian:backup:sandbox

# 逐篇核准合成資料下載（備份會在合成資料夾中落盤）
npm run verify:obsidian:backup:sandbox -- --approve-download=shared-note

# 核准合成下載，再另外核准恢復原本內容
npm run verify:obsidian:backup:sandbox -- --approve-download=shared-note --approve-restore=shared-note
```

這些 CLI 只能對硬編碼的 `shared-note` **合成筆記**操作，不能帶入真實本機路徑、實際私人筆記或 Neon 憑證。演練會印出備份數量、復原結果與是否有碰觸正式資料；**所有暫存測試檔在命令結束時顯式清除**。

## 2026-10-20：隔離待檢視副本的驗證邊界

- 僅新增 TypeScript 沙盒 API 和測試，不提供實際 MSI Vault 的寫入權限、遠端 Neon 同步端點或自動觸發功能。副本只存在工具自己建立的系統 TEMP `incoming/`，整個測試結束後隨沙盒明確清除；**不是可持久化的正式備份**。
- 新增 9 項專項回歸，涵蓋已存在原稿、缺少本機原稿、雙方衝突、錯誤／過期預覽、遠端版本變動、檔案建立後本機變動、不可重播與 lock 拒絕；均以合成內容操作，不讀取真實私人筆記。
- 因為此新路徑**完全不覆寫既有筆記**，不會發生該路徑把外部編輯者最後一刻更動的原稿直接覆蓋的問題。然而舊的合成覆寫／還原方法仍有 Windows 外部編輯器 TOCTOU 風險，並且**絕不可接上正式 Vault**。

## 2026-10-20：中斷備份完整性盤點（僅合成資料）

- **原本缺口：** `listDurableBackups()` 以前只查 `.json`；若系統在 `.bak` 已落盤、`.json` 尚未建立時中斷，這筆不完整交易會被清單忽略。
- **現在採 Fail Closed：** 列舉整個隔離 `backups/`，要求每個標準小寫 UUID **恰有一個 `.bak` 與一個 `.json`**，透過既有 SHA-256 驗證確認備份和交易紀錄配對。缺件、備份損壞、未知檔名、子目錄或連結、硬連結皆拒絕；超過 **1,024 個目錄項目**亦拒絕並要求人工檢查。這是合成沙盒的有界資源上限，不是正式備份保留量設定。
- **阻止後續風險：** `approvedDownload()`（包括新檔建立）、`saveBackup()`、`prepareRestore()` 都會在操作前執行盤點；異常時不會繼續對原稿進行寫入／復原。無自動修復、重新命名、刪除或忽略錯誤備份；保留現場讓操作者判斷。新建的非破壞性 `incoming/` 副本與備份目錄分離，不會偷偷修補損壞資料。
- **測試：** 7 個新增合成檔案系統測試涵蓋只有 `.bak`、只有 `.json`、已完成備份遺失 metadata、SHA 損壞、意外檔名、異常子目錄、另一筆未完成備份阻止復原；確認原稿保持不變，故障證據在沙盒清理前仍存在。
- **尚未解決：** 寫入 `.bak`／`.json` 仍是兩個獨立的建立動作，這個安全盤點只是讓系統**發現並停止**未完成交易，不表示交易已具備跨斷電的原子性。既有 `destroyScratch()` 會在**明確結束合成測試時**清掉臨時資料；沒有持久化正式備份，也不能把此機制套用到真實私人筆記。

## Windows 真正同步之前的工程決策（未實作）

1. **預設保留不覆寫模式。** 目前僅 `incoming/` 新建獨立副本可作安全研究；凡是可能取代正在編輯的原稿，必須先另行完成 Windows 原生跨程序同步方案和真人驗收。
2. **需要原生鎖定／版本一致性證據。** [Microsoft ReplaceFileW](https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-replacefilew) 支援檔案取代及指定備份檔，但**不提供以預期 SHA 為條件的原子 CAS**；[LockFileEx](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-lockfileex) 是以檔案 Handle 操作區段鎖定，不能僅靠本工具的 `.lock` 文字檔就推論 Obsidian 編輯器也會遵守。需要驗證外部編輯器同時寫入／改名、目標檔身分、ACL、分享模式、失敗回復與 NTFS 斷電情境。
3. **正式備份存放決策尚未核准。** 必須由 Owner 決定獨立、可持久化、可加密且具有 ACL 限制的備份位置，定義容量、保留天數與手動還原程序；不得將 TEMP 誤作正式備份或自行清除舊版本。
4. **跨程序與跨重啟測試尚未驗收。** 現有測試皆為隔離合成資料，不能聲稱 Windows 真實同步檔案鎖／持久化備份／實際恢復能力已完成。

## 測試與保證的界線

`tests/obsidian-durable-write-sandbox.test.mjs` 主要測試包含：正確 nonce 批准與期限、備份檔真實落盤與 metadata、先備份再覆寫、雙向變更偵測、stale preview、在 commit 前被修改時阻止寫入、同名新檔 `O_EXCL`、硬連結拒絕、兩個同步作業互斥、備份損壞拒絕復原、復原前更動拒絕、每次復原另留備份、一次性授權與確實清除合成測試路徑。

**目前不能宣稱已具備 Production 級原子性或持久性：**

1. Sandbox 檔案 fsync 已做；在 Windows 上對資料夾執行 fsync 可能被 OS 拒絕，仍需要驗證實際磁碟、斷電恢復及 Windows ACL／加密備份存放位置。
2. exclusive lock 只保護**使用同一把 lock 的同步程序**，不能阻止 Obsidian／同步軟體等外部編輯器在最後比對和 rename 間寫入。這個 TOCTOU 風險必須在真正 MSI Vault 啟用前解決。
3. 目前備份存活於 Sandbox 執行期間並落盤；合成環境在明確清理時刪除。正式環境需要**獨立且持久的備份磁碟路徑**、保留週期、加密／權限、容量限制及復原驗收，不得把系統 TEMP 當作正式備份空間。
4. 還沒有真正的 Neon Production 遠端讀寫執行器；Sandbox 中的 JWT／RLS／CRUD／過期修訂 E2E 先前已通過，但**不代表正式私人筆記已同步**。
5. 目前仍只允許 **手動觸發、逐篇確認、雙方衝突拒絕、永不自動刪除**；沒有背景排程、檔案監視、附件、改名、iPhone 同步。

## 接下來必須再次取得的授權

使用者先前已核准開發「備份與逐篇確認」但**沒有核准真正的 MSI Vault 或 Neon Production 寫入**。下一階段要使用合成筆記在指定的正式 Vault 與 Production 測試，必須另行授權精確筆記名、正式資料變更與清理範圍、備份位置／保留策略、正式版本 CAS 及故障復原。未完成之前不會解鎖正式雙向同步。

## 回歸指令

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/obsidian-durable-write-sandbox.test.mjs
npm run verify:obsidian:backup:sandbox
npm run test:unit
npm run typecheck
npm run build
npm run test:release:closed:local
```
