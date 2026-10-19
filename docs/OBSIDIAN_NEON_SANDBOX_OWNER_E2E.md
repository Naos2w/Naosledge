# Obsidian × Neon Sandbox — 真實合成站長 JWT／RLS／CRUD 端到端驗收

更新：2026-10-19。**已於 MSI 完成真實的 Neon Integration Sandbox 驗收並清除全部本輪合成資料。** 本文件不是 Production 或正式 Obsidian Vault 的同步啟用說明。

## 本輪核准與邊界

Owner 於 2026-10-19 正式授權只針對 `bitter-silence-36632892` 專案之**整合 Sandbox** `br-quiet-sunset-b4xx4pnx` 建立合成帳號／站長授權、測試私人筆記新增修改衝突，並清理這些合成紀錄。

- 真正執行使用固定 Sandbox Neon Auth／Data API URL；沒有使用正式帳號、Production DB、service role 或 SQL 管理員角色代替 JWT 執行 CRUD。
- 合成測試站長與一般使用者均以隨機名稱及 `@example.com` 合成信箱註冊；密碼、Auth cookies、JWT 僅存在執行程式記憶體，**不寫檔、不寫環境設定、不輸出至 CI／GitHub**。
- Sandbox 管理員授權在身份建立後由操作員使用**指定 Sandbox 分支**的 Neon 管理連線，只新增剛建立的特定合成 user ID；筆記 CRUD 仍由真正的**登入站長 JWT** 經 Neon Data API 與 RLS 執行。
- 測試用資料使用唯一 `obsidian-owner-e2e-*` slug；刪除只使用該篇 UUID + slug 的精確條件。完整清理後才允許刪除對應站長授權及兩個測試 Auth 使用者。
- **不會掃描或寫入** MSI 的 `C:\Naos\Obsidian\Naosledge`，沒有建立背景排程、同步 Production 或啟用付費服務。

## 2026-10-19 真實驗收通過的案例

| 測試 | 結果 |
|---|---|
| 合成站長與一般使用者取得有效 Neon Auth JWT | 通過 |
| Sandbox 管理員授權僅授予指定合成站長 | 通過 |
| 非站長無法新增私人筆記／讀取他人私人筆記 | 通過 |
| 站長 JWT 可以新增、讀取與修改自己私人筆記 | 通過 |
| Obsidian 可攜式 Markdown SHA-256 與真實 Neon 筆記一致 | 通過 |
| 站長新增一條私人 Wikilink、一般使用者不可讀取 | 通過 |
| 使用舊 `updated_at` 的條件式 PATCH 被拒絕覆寫 | 通過（回傳 0 個更新列） |
| 本機和遠端同時更動判斷為 conflict，不自動同步 | 通過 |
| 刪除精確合成筆記，Wikilink 由外鍵連鎖清除 | 通過 |
| 清理站長授權、兩位 Auth 身分與相關 account 紀錄 | 通過 |

測試程式：`scripts/smoke-obsidian-neon-owner-sandbox.ts`。它會等待操作員在 Sandbox 單獨完成合成站長授權，然後使用 JWT 驗證 RLS／資料操作；測試主體完成後，會嘗試清除合成筆記並只輸出必要的**合成 user ID 與 note ID**供授權操作員進行精確的 Auth／授權清理。

**清理後 Neon SQL 已再次核對：** Sandbox 站長授權 0、私人筆記 0、知識連結 0、發布來源映射 0、公開文章 0；10 項私人 RLS 政策不變。額外用 `neon_auth."user"` 和 `neon_auth.account` 精確比對當次兩個測試帳號 ID，剩餘皆為 0。Production 僅唯讀檢查，原有 1 筆站長授權、0 篇筆記及 0 篇文章，**沒有改動**。

## 重新執行的安全規則

此程式**不納入 GitHub CI、沒有 Cron、沒有自動資料庫授權操作**。日後若真要再次執行，須另外取得 Owner 同意，並由可同時操作 Sandbox Neon 與 MSI 的人員全程照管，避免中途留下合成帳號。

程式要求 MSI Windows + 固定 Sandbox project/branch + 下列**操作員明確確認旗標**；旗標不存在時**不會產生帳號或網路請求**：

```powershell
$env:NAOSLEDGE_SYNTHETIC_SANDBOX_WRITE_APPROVED = "SYNTHETIC_SANDBOX_ONLY"
npm run verify:obsidian:neon:sandbox:owner:e2e
Remove-Item Env:NAOSLEDGE_SYNTHETIC_SANDBOX_WRITE_APPROVED
```

執行程式會在 `WAITING_FOR_SANDBOX_ADMIN_GRANT` 停下來輪詢：操作員必須只在分支 `br-quiet-sunset-b4xx4pnx`，以程式當次顯示的合成站長 ID 新增 `public.blog_admins` 授權。**絕對不要在 Production 或其他 Sandbox 複製這個 ID；不能用既有真人站長 ID。**

成功或失敗後，操作員須依當次 `SANDBOX_CLEANUP_HANDOFF` 紀錄，逐一完成：(a) 精確合成筆記／連結殘留檢查；(b) 僅刪除該合成站長的 `blog_admins` 授權；(c) 使用 Neon Sandbox Auth 使用者刪除介面清除兩個特定合成使用者；(d) 再次驗證`notes=links=admins=users=accounts=0`。不能因程式印出通過就跳過這些操作。

測試最終已驗收完成，**不需要為了此次已完成的證據重新執行或額外消耗 Sandbox 額度**。

## 並不代表已完成的部分

- 真正把使用者 MSI Vault 的非合成 Markdown 以 Owner Auth/JWT 傳送到 Neon Production，尚未實作／授權。
- Windows 實際筆記的持久、加密備份與檔案系統鎖、長時間離線後衝突 UI、跨程序原子 compare-and-swap，仍需獨立設計。
- Obsidian 的 rename、巢狀資料夾、附件、中文檔名映射與多裝置同步，仍需後續開發。
- 真正雙向同步仍維持「手動觸發、逐篇確認、無自動刪除」。沒有啟用自動寫入或排程。

## 專案測試

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/obsidian-neon-owner-sandbox-approval.test.mjs
npm run test:unit
npm run typecheck
npm run build
npm run test:release:closed:local
```

這些離線測試會確保其他分支／電腦、沒有確認旗標時，**無法啟動真實 Sandbox 測試**。已通過的真實測試結果可由 GitHub PR #19 的驗收紀錄與安全清理證據追蹤。
