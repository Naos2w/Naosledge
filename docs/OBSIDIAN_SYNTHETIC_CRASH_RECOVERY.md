# NaosLedge — 中斷後唯讀備份復原盤點（合成沙盒）

更新：2026-10-23。這是**兩個真實 OS 程序交接的故障演練**，不是強制斷電、Windows 系統重啟、正式備份或災難復原的驗收。禁止操作真正 MSI Obsidian Vault、Neon Production、私人原稿、付費服務或背景自動同步。

## 執行

```powershell
npm run verify:obsidian:recovery:sandbox
```

此命令執行 `tests/obsidian-crash-recovery.test.mjs`。測試驅動程式啟動第一個子程序 `scripts/obsidian-synthetic-interrupted-writer.ts`，由既有 `createDurableSyntheticObsidianWorkspace()` 在系統 TEMP 正下方建立隨機 `naosledge-durable-synthetic-only-*` 的專屬測試資料夾，完成單篇**合成**原稿替換與有效 `.bak`／`.json` 配對。之後另建一筆獨立 `.bak`、刻意不建立對應 metadata，並留下 `backup-catalog.lock`，以指定的非零結束碼退出，**不執行該子程序自己的正常清理**。

另一個新的 Node 程序執行 `scripts/obsidian-detached-synthetic-recovery.ts --inspect-id <synthetic-id>`，只接收系統產生的安全資料夾**名稱**，禁止接收任意路徑或額外參數；使用 `tmpdir()`、直接子目錄、`lstat`／`realpath` 及工廠內建的 `.synthetic-recovery-marker` 限定隔離盤點範圍。這個 marker 是非機密測試範圍提示，**不是加密簽章或身分驗證**。

## 唯讀盤點結果

獨立檢查程序只讀取經限制的備份目錄和鎖檔目錄，不讀取 `notes/*.md`，並在輸出中只回報統計值：

| 驗證情境 | 預期 |
|---|---|
| 寫入程序已退出，原始記憶體狀態不存在 | 新程序可重新盤點 |
| 1 組有效 SHA-256 備份 | `validPairs=1` |
| 1 筆只寫入 `.bak` 的中斷交易 | `orphanBackups=1` |
| 1 個殘留互斥鎖 | `staleLockEntries=1` |
| 任何孤兒、損壞或未知檔案 | `needsManualReview=true` |
| Metadata 被竄改／格式不符 | `invalidPairs=1` |
| 超過 1,024 項 | `inspectionComplete=false`，未完成分類為 `null` |
| 缺少工廠 marker、路徑跳脫、額外 CLI 參數 | 拒絕檢查 |

相同 fixture 由**第二次獨立檢查程序**重跑後結果必須一致；盤點前後比較實體檔案、殘留鎖及原稿內容，證明檢查沒有自動修補、刪除、恢復或接手寫入。測試驅動程式**只有在核實完整生成的 TEMP 路徑後**，才會明確清理此單次合成 fixture，並在其中一組測試中人工刪除精確的合成孤兒檔／鎖檔，驗證重新盤點可回到健康狀態；這些動作不屬於檢查器，也絕不面向正式 Vault。

## 已知缺口與真正 P0 驗收

- 這是**程序終止**與不完整交易模擬；未發生機器斷電、NTFS 緩衝／硬體寫入快取中斷、整台 Windows 重新開機或檔案系統失敗。
- 新獨立讀取器目前是**合成專用**且未接到主服務。它重複嚴格檢查備份欄位、SHA 與容量限制，後續應與正式版共同抽離唯一資料格式驗證核心，避免兩套規則分歧。
- 目前沒有受核准的持久化加密備份目錄、備份快照一致性、ACL、保留政策、跨重啟稽核收據／數位簽章，不能把 TEMP 沙盒視為有效的災難備份。
- 非合作的 Windows 外部編輯器仍可能在最後核對與 `rename` 之間寫入；參閱 [Windows CreateFileW 分享模式實證](OBSIDIAN_WINDOWS_NATIVE_SAFETY.md)。沒有原子 CAS／鎖定與失敗恢復的獨立驗收前，正式同步只可朝 **non-destructive Incoming Copy** 推進，不可自動覆寫。

這項演練的唯一結論是：**原始寫入程序結束後，另一個無共享記憶體的新程序仍能唯讀發現異常，並持續阻擋自動恢復決策。**
