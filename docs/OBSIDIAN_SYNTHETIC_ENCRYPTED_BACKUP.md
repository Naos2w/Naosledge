# NaosLedge — 加密備份原型（僅限合成 TEMP 沙盒）

更新：2026-10-23。本實作銜接 [PR #24 的 Windows 原生分享模式和程序中斷驗證](OBSIDIAN_WINDOWS_NATIVE_SAFETY.md)，但**不會**備份或讀取任何真正的 MSI Obsidian Vault，也沒有 Neon Production、正式金鑰管理服務、資料庫同步、排程、原稿覆寫或自動復原。這是離線加密格式及隔離程序重開測試，**不是**可以投入營運的持久加密備份服務。

## 操作

```powershell
npm run verify:obsidian:encrypted:sandbox
```

這項命令執行 `tests/obsidian-encrypted-archive.test.mjs`。所有寫入路徑由 `lib/obsidian-synthetic-encrypted-archive.ts` 在 `tmpdir()` 正下方隨機建立 `naosledge-encrypted-synthetic-only-*`，內有唯讀用途的固定非機密 marker 與 `records/`。**沒有傳入任意路徑的 API**；僅接受 `synthetic-*` 筆記名稱及以 `NAOSLEDGE_SYNTHETIC_NOTE:` 開頭的假資料，單篇明文上限 250 KiB、最多 128 筆封存交易，檔案以 `wx` 排他建立、檔案 `fsync`，資料夾同步盡力而為。系統 TEMP 不等於斷電後獨立可還原的備份碟。

## 加密與金鑰界線

- 使用 Node 內建 `crypto` 的 **AES-256-GCM**（256 位元金鑰、每筆 CSPRNG 隨機 96 位元 Nonce、128 位元認證 Tag）。每筆加密的關聯資料（AAD）綁定版本及隨機記錄 ID，竄改密文、Nonce、Tag、格式、ID 或欄位都會 Fail Closed。
- 筆記名稱、合成內容、建立時間在**加密負載內部**。磁碟只儲存 `version`、`id`、`syntheticOnly`、`algorithm`、`nonce`、`tag` 和 `ciphertext`。仍會揭露檔案數量、ID、密文長度與加密模式，不宣稱完全隱藏 metadata。
- 工具**不產生、保存或匯出正式金鑰**；獨立測試驅動器用 `randomBytes(32)` 生成暫時性測試金鑰，透過程序的標準輸入（不是 CLI 參數、環境變數或 Git 檔案）交給一次性的測試 Writer/Reader。新程序需要相同金鑰才能驗證／還原合成明文；錯誤金鑰不能讀取或修改備份。程式不記錄測試金鑰與解密內容。
- **遺失金鑰就無法解密**。此處尚無 Windows DPAPI/TPM／Credential Manager 整合、金鑰封套或離線金鑰保管、存取稽核、金鑰輪換、備份主金鑰／撤銷流程；這些是正式加密備份前必須解決的 P0，不可用 TEMP 測試金鑰代替。
- 此示範使用 OS TEMP 的權限配置與 Node `mode` 請求；**不能宣稱已驗證 Windows ACL、加密磁碟隔離、防勒索軟體、FIPS 驗證、檔案映射競爭或硬體斷電耐久性**。

## 本輪隔離驗收

| 測試 | 必須符合 |
|---|---|
| Writer 程序正常退出，另一個 Reader 程序重新開啟 | 使用獨立傳入的同一金鑰完成 GCM 認證，**不自動還原原稿** |
| 相同合成筆記重複加密 | 不同記錄採不同 Nonce／密文 |
| 備份檔案 | 沒有可搜尋的合成 slug、筆記明文、金鑰 |
| 換成錯誤金鑰 | 拒絕，保留證據檔案 |
| 竄改 Header／Tag／Nonce／密文或加入未知欄位 | GCM 認證或嚴格格式驗證失敗、備份唯讀統計 `needsManualReview=true` |
| 不完整、未知檔案或超過 128 筆 | 拒絕後續寫入；超限報告的未完成分類改為 `null` |
| 任意路徑、假 marker、錯誤 ID、真實筆記字串 | 不可當作合法備份來源 |

即使同一 TEMP 沙盒尚未清除，進程結束後備份檔能被另一個進程解密，這仍只證明**程式生命週期分離**，不代表電腦重啟或斷電後可保留、也不代表獨立的備份失敗域。所有示範檔由**測試驅動器明確且限定路徑**清除；實作本身沒有自動備份輪替／垃圾回收、任意路徑還原或刪除正式資料的功能。

## 正式 P0 尚需

1. Owner 核准與 Vault 分離的實體備份位置、磁碟加密與 Windows ACL，並定義幾份備份、保留天數、容量、離線副本與災難復原責任。**尚未設定或啟用。**
2. 將 AES-256-GCM 認證格式交由獨立安全審查，確認金鑰產生／保管／輪替／遺失復原與雙層加密威脅模型，避免測試性 API 被誤接入正式路徑。
3. 以乾淨隔離資料驗證完整中斷／程序重啟／**真實 Windows 開機與斷電**、檔案損壞、磁碟滿／中途斷電的操作手冊，保留可信證據與復原操作日誌；無法對正式筆記直接強制重啟或拔電。
4. 外部 Obsidian 編輯器的 Windows 原生 Handle 協定與內容 CAS／TOCTOU 仍未解決；正式資料一律維持不覆寫 Incoming Copy 模式，沒有審查和 Owner 正式授權不能接 Production 同步。

參考規範：[OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)、[OWASP Key Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)。
