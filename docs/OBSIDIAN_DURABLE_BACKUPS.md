# Obsidian 正式同步寫入防護：逐篇確認、磁碟備份與手動復原

更新：2026-10-23。本文件記錄 **正式同步檔案安全機制的隔離原型與合成驗證**，但**沒有啟用** MSI 正式 Vault 與 Neon Production 的雙向寫入。Owner 先前只核准開發與隔離合成測試，Production 實測必須再取得獨立授權。

## 2026-10-23：PR #21 + PR #22 獨立整合分支

本次從 PR #21 的 `39a5ff1` 建立**新的本機整合分支** `feat/obsidian-pr21-pr22-integration-20261023`，先把原本的 3 份未提交修改固定成 `fd09941`，再整合 PR #22 的 `ec4b8dc`。原本兩個 PR 的遠端分支保留，不是合併到 `main`，也沒有動到正式 Vault、Neon Production 或 Vercel。

- **保留兩個安全路徑：** PR #21 的逐篇 `incoming/` 非覆寫副本與落盤 SHA 驗證；PR #22 的嚴格 Manifest、唯讀備份清單健康盤點、異常拒絕寫入、同一沙盒合作程序互斥、真實獨立子程序競爭測試、`.staged-*` 摘要與檔案身分核對。
- **合併後的行為修復：** 健康且剛好達到 512 組備份上限時，新的**覆寫／還原備份**必須被拒絕，但 `approvedStageIncoming()` 只建立隔離待檢視副本、不產生新的備份配對，因此僅需驗證目錄**健康**而不預留兩個備份名額。損壞、孤兒或未知備份仍拒絕所有合作寫入並保留人工調查證據。
- **本機驗證：** 合成備份專項 59／59 PASS，容量／非覆寫回歸另加驗證；完整單元測試 **276 項（275 PASS／1 OS 權限 SKIP／0 FAIL）**、TypeScript、Next.js 16 Build、10 路由 Production fail-closed、3 種合成預覽／備份／還原示範全部 PASS。GitHub CI、獨立 Reviewer、真實 Windows 原生 CAS、斷電恢復及 Production E2E 尚未通過或執行，不能借用本機測試宣稱可發布。

**仍有 P0 風險：** 任何最後檔案身分核對到 `rename` 之間都存在 TOCTOU；`fsync`、鎖檔與兩份 Manifest 檢查不是 Windows 原生檔案分享鎖、原子條件替換或加密持久備份。仍禁止直接接到正式 MSI Obsidian Vault。

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
- **2026-10-22 合成待檢視副本的落盤核對：** 在 fsync 後、回傳副本 SHA-256 收據之前，額外重新開啟剛建立的 `incoming/` 檔案，檢查它仍存在、是安全的單一一般檔案，而且實際內容的 SHA-256 等於逐篇預覽核准的遠端指紋。若副本被修改或刪除則拒絕成功結果，僅清理當次副本而不更動原稿；新增 2 項隔離回歸測試。此檢查是特定時間點的完整性驗證，**不是**密碼學身分驗證、Windows 原生鎖定、跨斷電持久性或正式 Vault 同步授權。

## 2026-10-20：中斷備份完整性盤點（僅合成資料）

- **原本缺口：** `listDurableBackups()` 以前只查 `.json`；若系統在 `.bak` 已落盤、`.json` 尚未建立時中斷，這筆不完整交易會被清單忽略。
- **現在採 Fail Closed：** 列舉整個隔離 `backups/`，要求每個標準小寫 UUID **恰有一個 `.bak` 與一個 `.json`**，透過既有 SHA-256 驗證確認備份和交易紀錄配對。缺件、備份損壞、未知檔名、子目錄或連結、硬連結皆拒絕；超過 **1,024 個目錄項目**亦拒絕並要求人工檢查；當完整備份已達 **512 組**時，新增備份會在落盤之前拒絕，避免一筆新交易讓目錄突破上限。這是合成沙盒的有界資源上限，不是正式備份保留量設定。
- **阻止後續風險：** `approvedDownload()`（包括新檔建立）、`saveBackup()`、`prepareRestore()` 都會在操作前執行盤點；異常時不會繼續對原稿進行寫入／復原。無自動修復、重新命名、刪除或忽略錯誤備份；保留現場讓操作者判斷。新建的非破壞性 `incoming/` 副本與備份目錄分離，不會偷偷修補損壞資料。
- **測試：** 7 個新增合成檔案系統測試涵蓋只有 `.bak`、只有 `.json`、已完成備份遺失 metadata、SHA 損壞、意外檔名、異常子目錄、另一筆未完成備份阻止復原；確認原稿保持不變，故障證據在沙盒清理前仍存在。另加 1 項純函式容量邊界測試，驗證新增前保留完整 `.bak`＋`.json` 所需的兩個名額；沒有進行 512 組實體檔案壓力測試。
- **尚未解決：** 寫入 `.bak`／`.json` 仍是兩個獨立的建立動作，這個安全盤點只是讓系統**發現並停止**未完成交易，不表示交易已具備跨斷電的原子性。既有 `destroyScratch()` 會在**明確結束合成測試時**清掉臨時資料；沒有持久化正式備份，也不能把此機制套用到真實私人筆記。

## Windows 原生安全實證（2026-10-23，隔離資料）

已新增 [MSI CreateFileW 分享模式競爭測試與風險清單](OBSIDIAN_WINDOWS_NATIVE_SAFETY.md)，以隨機 TEMP 合成筆記及另一個 OS 程序，確認 Handle 持有中可拒絕修改、改名與刪除；Handle 關閉後這些操作仍會恢復，因此測試結果不是原子 SHA-CAS、正式同步或持久化復原的授權。

另完成 [合成中斷後跨程序唯讀復原盤點](OBSIDIAN_SYNTHETIC_CRASH_RECOVERY.md)：第一個 Node 程序留下完整備份、孤兒 `.bak` 與互斥鎖後刻意退出，第二個獨立程序可統計異常及阻止自動復原；檢查器不修補／刪除任何檔案，所有資料仍只在隨機 TEMP 測試資料夾。此演練**不是**真實 Windows 重新開機或斷電驗收。

## AES-256-GCM 加密備份格式實證（2026-10-23，隔離資料）

已新增 [加密備份合成沙盒與跨程序解密測試](OBSIDIAN_SYNTHETIC_ENCRYPTED_BACKUP.md)，以隨機獨立金鑰對合成內容進行 AES-256-GCM 認證加密，只在 OS TEMP 儲存不含明文與金鑰的封存檔；新程序必須從測試驅動器獨立取得金鑰才能驗證。錯誤金鑰、Tag／密文篡改、不合法 Header 與未知檔案皆拒絕，且原封保留證據；**仍無正式的金鑰保管、獨立備份磁碟、保留策略、斷電驗收與 Production 恢復**。

## Windows 真正同步之前的工程決策（未實作）

1. **預設保留不覆寫模式。** 目前僅 `incoming/` 新建獨立副本可作安全研究；凡是可能取代正在編輯的原稿，必須先另行完成 Windows 原生跨程序同步方案和真人驗收。
2. **需要原生鎖定／版本一致性證據。** [Microsoft ReplaceFileW](https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-replacefilew) 支援檔案取代及指定備份檔，但**不提供以預期 SHA 為條件的原子 CAS**；[LockFileEx](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-lockfileex) 是以檔案 Handle 操作區段鎖定，不能僅靠本工具的 `.lock` 文字檔就推論 Obsidian 編輯器也會遵守。需要驗證外部編輯器同時寫入／改名、目標檔身分、ACL、分享模式、失敗回復與 NTFS 斷電情境。
3. **正式備份存放決策尚未核准。** 必須由 Owner 決定獨立、可持久化、可加密且具有 ACL 限制的備份位置，定義容量、保留天數與手動還原程序；不得將 TEMP 誤作正式備份或自行清除舊版本。
4. **跨程序與跨重啟測試尚未驗收。** 現有測試皆為隔離合成資料，不能聲稱 Windows 真實同步檔案鎖／持久化備份／實際恢復能力已完成。

## 2026-10-22：合成備份交易紀錄的輸入驗證

原先 PR #22 是**獨立於 PR #21 的小範圍安全改進**；此整合分支同時保留兩者的合成測試防護，只處理既有沙盒中 `backups/<uuid>.json` 的讀取驗證，不啟用任何實際 Obsidian Vault、Neon Production 或自動同步。

- `loadBackup()` 嚴格要求 6 個原有欄位：`id`、`slug`、`beforeSha`、`afterSha`、`createdAt`、`syntheticOnly`。多餘、缺少或型別不符的欄位均拒絕，不允許路徑、憑證或其他未規劃的資料混入交易紀錄。
- `slug` 限制為 3～120 字元的安全格式；交易 ID 必須與實際備份檔案 ID 相符。時間必須是合法、標準化的 UTC 毫秒 ISO 格式，防止損壞日期影響排序或審查。
- 個別 `.json` 紀錄限制為 4 KiB；仍沿用 SHA-256 驗證 `.bak` 的內容。異常時停止列舉／準備還原，不改動原始筆記，也不自動刪除異常紀錄。
- 新增 2 組回歸測試，覆蓋多餘欄位、遺失時間、非法日期、路徑跳脫、不符 ID、過大紀錄，以及還原核准後紀錄被篡改。所有輸入均為沙盒合成資料。

這些檢查只增加**格式與內容完整性防護**，不代表具有可防惡意持有人竄改的數位簽章，也不解決 Windows 外部編輯器競爭、真正的持久化備份、斷電復原或 PR #21 的獨立安全審查。

### 合成備份唯讀復原盤點

`createDurableSyntheticObsidianWorkspace()` 現提供 `inspectSyntheticBackupRecovery()`，在工具自行建立的 **TEMP 隔離沙盒**內，對備份進行唯讀檢查並回傳**不含檔名、路徑、筆記 slug、Markdown 內容或備份 ID** 的統計摘要：

- 完整且通過原有 SHA-256／JSON 驗證的 `.bak`＋`.json` 配對數；缺少 metadata 的 `.bak` 數；缺少備份的 `.json` 數；配對損壞與非預期目錄項目數。
- 最多檢視 1,024 個目錄項目；超過上限時，`inspectionComplete=false`、未完成的分類計數一律為 `null`，`needsManualReview=true`。不可將部分掃描當作健康結果。
- `needsManualReview=false` 只表示**當次盤點未發現問題**，**不是**同意覆寫或還原的授權；盤點不會清理任何資料，也不會自行阻擋舊版合成覆寫 API。真正的檔案覆寫安全關卡仍須依獨立 PR #21 完整整合與驗收。
- 此 API 沒有可傳入的任意目錄參數，不會重新開啟已終止的沙盒，也沒有正式備份磁碟、持續監控或真實 Windows 外部編輯器 CAS 能力；事故時必須保留檔案並另行人工調查。

### 合成備份異常的強制寫入阻擋（2026-10-22）

原本 `inspectSyntheticBackupRecovery()` 只能回報警告，核准的合成寫入仍可能繼續。現在正式連接到**沙盒寫入關卡**：

- `approvedDownload()`、`approvedRestore()` 進入寫入鎖後先執行完整備份盤點；發現缺少 `.bak`／`.json`、內容損壞、未知目錄項目或掃描未完成，一律拒絕寫入。即使只是建立原本不存在的合成筆記，也要求先通過這項檢查。錯誤不列印筆記正文／檔案名稱。
- 建立新的備份前再次核對健康狀態，至少預留一筆完整 `.bak`＋`.json` 的兩個目錄名額（最多 1,024 個項目）；備份完成、覆寫前再驗一次，避免已經損壞的備份成為後續原稿替換依據。
- 同一沙盒除了逐篇 `.lock`，還加入 `locks/backup-catalog.lock`，透過 `wx` 排他建立，讓**合作使用同一套程式的不同筆記寫入**不會同時產生半完成的備份配對。鎖定失敗時不繞過、不等待暴力刪除鎖檔；失敗／成功均釋放本程序實際持有的鎖。
- 新增缺件、未知項目、還原前損壞、備份後被篡改、不同筆記並行寫入，以及 **512 組完整備份達到容量上限時拒絕新增交易** 的隔離測試。原稿與異常備份證據在測試沙盒結束之前保留供檢查。

**界線：** 這是工具自己的合成 TEMP 沙盒保護；非合作的外部程序仍可能修改目錄／檔案，盤點與寫入不是跨程序原子快照；也沒有正式加密備份／磁碟持久化或 Windows native CAS。舊版的 `listDurableBackups()` 不應取代本安全關卡，且這次**沒有接通真正的 MSI Vault 或 Neon Production**。

### 2026-10-23：合成暫存替換檔的提交前完整性檢查

`replaceStaged()` 在暫存檔 fsync 後保存其 SHA-256 與 `dev`／`ino`／`size`／`mtimeMs`／`ctimeMs` 身分，執行合成測試的提交前檢查後、`rename` 之前再次開啟並核對暫存檔。內容被改寫、檔案被移除、或 SHA 相同但檔案身分已替換時，均拒絕**合成**覆寫／還原，保留原始筆記與已產生的可逆備份；失敗的 `.staged-*` 由現有 `finally` 清理。

新增 3 項定向回歸涵蓋內容竄改、暫存檔消失、及同 SHA 不同檔案身分的還原拒絕；這些測試在修正前 3/3 失敗、修正後 3/3 通過；完整單元測試、TypeScript、Next.js build、10 路由關閉版安全測試及 3 種合成備份／還原示範亦全部通過。**這不是數位簽章、持久化加密備份或 Windows 原生條件式原子替換**：核對與 `rename` 之間仍有 TOCTOU，非合作外部編輯器仍可能介入，所以禁止用於正式 MSI Vault 或 Neon Production 寫入。

## 2026-10-22：Windows 跨程序競爭演練（仍僅合成沙盒）

在 MSI 的 Windows 環境，測試新增以 `execFile(process.execPath)` 啟動**另一個作業系統程序**模擬外部編輯器。子程序的寫入目標由測試從工廠產生的隨機 TEMP 沙盒 `notes/` 組成，不能指定真實 Obsidian Vault、任意磁碟路徑或 Neon；所有檔案在合成測試結束時清除。

- 驗證原稿在備份之後、正式合成覆寫之前被另一個程序修改時，既有 SHA-256 比對會拒絕覆寫，並保留修改後原稿與備份。
- 驗證另一個程序先建立同名新筆記時，獨佔建立（`wx`）拒絕取代已存在檔案。
- 驗證逐篇核准的合成還原中途有另一個程序修改筆記時，拒絕還原，保留目前內容和撤銷備份。
- **加強同內容替換檢查：** 外部程序先將舊檔移至沙盒保留檔，再建立 SHA 相同但檔案身分不同的新檔。寫入器在備份前記錄並於最後檢查 `dev`、`ino`、`size`、`mtimeMs`、`ctimeMs`，內容摘要相同但檔案身分／metadata 變更時仍拒絕合成覆寫與合成還原。
- 這是**樂觀版本檢查**，不等於 Windows 原生跨程序互斥。外部編輯器不一定遵守本工具的 `.lock`，而且「最後身分檢查 → `rename`」仍存在 TOCTOU 視窗；不得將本沙盒實驗直接接到正式 MSI Vault。真正的 Windows 檔案分享模式、LockFileEx、ACL、原子一致性及斷電恢復仍是未完成的 P0 驗收項目。

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
