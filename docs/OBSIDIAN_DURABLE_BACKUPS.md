# Obsidian 正式同步寫入防護：逐篇確認、磁碟備份與手動復原

更新：2026-10-19。本文件記錄 **正式同步檔案安全機制的實作與合成驗證**，但**沒有啟用** MSI 正式 Vault 與 Neon Production 的雙向寫入。此次 Owner 只核准開發與隔離合成測試，Production 實測必須再取得獨立授權。

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
