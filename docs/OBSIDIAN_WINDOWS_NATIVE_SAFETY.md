# NaosLedge — Windows 原生檔案競爭防護實證（隔離合成資料）

更新：2026-10-23。此項工作屬於 **NaosLedge PR #23 之後的安全實驗**，不是 Production Writer，不會修改 `C:\Naos\Obsidian\Naosledge` 或 Neon Production，也沒有自動同步、刪除、發布或付費操作。

## 執行與驗收

```powershell
npm run verify:obsidian:windows:native:sandbox
node --test tests/obsidian-windows-native-share.test.mjs
```

腳本 `scripts/obsidian-windows-native-share-smoke.ps1` **不接受任何目標路徑參數**，只建立 Windows `GetTempPath()` 正下方、隨機命名的 `naosledge-native-share-synthetic-only-<guid>` 一次性資料夾，並只處理 `synthetic-note.md`。測試結束後以校驗父路徑及命名規則的 `finally` 清理整個專屬合成資料夾。

PowerShell `Add-Type` 調用 Kernel32 `CreateFileW`，以 `GENERIC_READ` 與 **`FILE_SHARE_READ`** 開啟自行產生的原稿，持有 `SafeFileHandle`。不同的 Windows PowerShell 子程序嘗試讀取、寫入、改名、刪除同一個檔案，結果預期如下：

| 情境 | 子程序預期 | 說明 |
|---|---|---|
| Handle 持有中：讀取 | 允許 | 只開放 `FILE_SHARE_READ` |
| Handle 持有中：修改內容 | 拒絕 | 不允許其他寫入 Handle |
| Handle 持有中：改名 | 拒絕 | 不允許刪除／改名所需分享存取 |
| Handle 持有中：刪除 | 拒絕 | 不允許刪除分享存取 |
| Handle 關閉後：寫入／改名／刪除 | 允許 | **刻意驗證鎖定並非永久** |

每一步都在另一個真實作業系統程序執行並驗證退出碼、原稿內容與移動／刪除後檔案狀態。任一預期不成立立即失敗；結果只輸出已去識別的狀態布林值，不包含測試檔案路徑、原稿正文、Neon 憑證或正式帳號。

`tests/obsidian-windows-native-share.test.mjs` 在 Windows 真正執行這項實驗；在非 Windows 的 GitHub CI 環境，僅保留靜態安全性測試，原生 OS 測試清楚標示 **SKIP**，不能視為 Windows 端通過。

## 此測試「不是」什麼

- `CreateFileW` 的分享模式僅在該 Handle 存在時有效；解除後與最後 SHA 核對之間的跨程序競爭風險仍存在，**不等於 `compare-and-swap`**。
- Windows `LockFileEx` 處理位元組區段的鎖定，也**無法保證記憶體映射（memory-mapped）的存取行為**；未以本實驗證明 Obsidian 或第三方同步外掛會遵循同一契約。
- `ReplaceFileW` 可進行檔案替換並支援備份，但無內建「比對使用者預期 SHA 才條件式替換」的原子保證，也有額外的失敗與 ACL／檔案分享狀態。不能單純把它接在現有 `replaceStaged()` 後宣稱資料安全。
- 只測試合成檔案分享行為，**未驗證**不同 NTFS 卷、網路磁碟、Obsidian 長時間開啟 Handle、既有持有寫入權限的 Handle、記憶體映射、ACL／EFS／BitLocker、外掛程序、更名競爭、突然斷電／磁碟 Flush 保證。
- 程式未提供任何接受真實 Vault 路徑的 Native Writer API；`lib/obsidian-durable-write-sandbox.ts` 的合成覆寫仍有最後核對 → rename 的 TOCTOU，所以只允許隔離演練，正式路徑持續預設 **non-destructive Incoming Copy**。

## 原生安全與故障復原後續驗收關卡

1. 先在同一 TEMP 隔離資料夾做真正的 OS 子程序退出／重啟盤點，驗證中斷的備份配對會被保留、唯讀報告異常且不自動清理或恢復。
2. 設計可稽核的 Windows 原生寫入交易方案：在所有程序願意遵守的前提下維持 Handle、檔案身分、正式備份、提交日誌與回滾證據；未證明對非合作編輯器安全之前，不覆寫正式原稿。
3. 明確配置 **持久磁碟、加密、ACL、容量與保留週期**，並驗證機器重啟、程序崩潰、磁碟失敗與中途復原。系統 TEMP 及現有示範不算正式備份。
4. 真正 MSI Vault／Neon Production 啟用前，另行取得 Owner 對操作範圍及資料變動的明確授權，經正式獨立安全審查與授權發布 Gate；先做已核准合成 E2E，不擅自接上資料庫。

官方參考：
- [Microsoft CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
- [Microsoft LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)
- [Microsoft ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)
