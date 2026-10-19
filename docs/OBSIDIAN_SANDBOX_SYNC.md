# Naosledge × Obsidian — 手動確認式雙向同步沙盒

更新：2026-10-19。**這不是已啟用的正式同步功能**，而是一套完全隔離的 TypeScript 同步預演，可在真正連接 Auth／資料庫之前，驗證本機檔案覆寫與遠端版本競爭。

## 已核准的安全規則

使用者已核准：**每次手動觸發、每篇需要明確確認、衝突不得直接覆寫、永不自動刪除**。任何排程、直接正式站長帳號授權與生產筆記寫入，均不在此核准範圍內。

## 沙盒的實際隔離

- 本機只建立 OS 暫存目錄下的 `naosledge-obsidian-sandbox-only-*` 資料夾，使用合成 Markdown，結束後清除。
- 模擬遠端只有 Node.js 記憶體 Map，**不是 Neon**，不會連上正式或 Sandbox 的 Auth／Data API。
- 不會開啟／掃描／寫入 `C:\Naos\Obsidian\Naosledge`；正式 Vault 仍只有單獨的唯讀指紋檢查。
- 不含正式同步 API endpoint、密鑰、Cookie、排程或背景工作。
- 程式使用 TypeScript，透過 Node.js 24 的 type stripping 執行。

## 沙盒可以驗證什麼

| 情況 | 處理方式 |
|---|---|
| 本機有、遠端沒有 | `review-missing-remote`；需為該篇提供 `APPROVE UPLOAD slug` 才會建立記憶體遠端 |
| 遠端有、本機沒有 | `review-missing-local`；需 `APPROVE DOWNLOAD slug` 才會在暫存目錄建立檔案 |
| 只有本機修改 | `review-upload`；比對兩邊 SHA／遠端 revision 後才更新模擬遠端 |
| 只有遠端修改 | `review-download`；覆寫暫存檔前先備份，再次核對檔案後原子替換 |
| 雙方都改、或初次同名不同內容 | `conflict`；兩個方向都拒絕，不靠修改時間猜測 |
| 預覽後檔案或遠端版本改變 | 拒絕使用舊預覽覆寫 |
| 缺少筆記、可能刪除 | 只列為人工審查，**絕不自動刪除** |
| 同一批准重複執行 | 預覽已失效，必須重新確認 |

**界線：** 暫存沙盒原子替換不能證明真實 Windows Vault 的檔案鎖、持久備份或 Neon 遠端交易式 CAS。未來仍需真實身分驗證、RLS、Sandbox 驗收與 Owner 授權。

## 指令：僅預覽（沒有傳輸）

```powershell
npm run verify:obsidian:sync:sandbox
```

會短暫建立三份合成筆記，只印出差異與衝突分類，不同步，隨後清除暫存資料。

## 指令：逐篇核准合成傳輸

```powershell
npm run verify:obsidian:sync:sandbox -- --approve-upload=local-edited
npm run verify:obsidian:sync:sandbox -- --approve-download=remote-edited
npm run verify:obsidian:sync:sandbox -- --approve-upload=local-edited --approve-download=remote-edited
```

每一個選項都是該篇獨立的合成資料核准。`both-conflicted` 仍必須保持衝突狀態，不允許寫入。這些選項只能用於預先定義的合成筆記，不接受外部路徑或正式筆記內容。

## 尚未完成與安全界線

1. 以 Owner 的 Neon Auth JWT／RLS 取得真正遠端唯讀 manifest。第一輪只能在核准的 Neon 整合 Sandbox 驗證，禁止先直連 Production。
2. 正式 Vault 的持久備份、跨程序檔案鎖與遠端原子 compare-and-swap；不能直接把 `updated_at` 當成完整樂觀鎖。
3. 人工檢查的正式上傳／下載介面、失敗復原、離線、rename、附件映射；一律不自動刪除。
4. 是否需要週期執行或 iPhone 多裝置同步，仍需另外授權；目前沒有背景排程。

### 已核對環境

MSI Obsidian 已安裝，`C:\Naos\Obsidian\Naosledge` 已完成 GUI 註冊、沒有真實 Markdown。獨立 Neon Sandbox `br-quiet-sunset-b4xx4pnx` 存在；唯讀檢查為 0 篇私人筆記、0 筆站長授權、10 項 RLS 政策。本輪沒有在 Neon 建立合成帳號或寫入資料。

### 本地驗證

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/obsidian-sync-sandbox.test.mjs
npm run test:unit
npm run typecheck
npm run build
npm run test:release:closed:local
```
