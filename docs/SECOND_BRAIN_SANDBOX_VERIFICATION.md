# Second Brain P1＋P2 — Neon Sandbox 實體驗收

歷史驗收報告：本文件記錄 Sandbox 當時的執行結果。**後續在 2026-10-17 已依使用者另一項核准完成 Production 的 002 Migration**；請以 README 及 PR #2 最新更新判斷目前狀態。

日期：2026-10-17（台灣時間）。目標僅為 **Naosledge Free Neon Sandbox**
`bitter-silence-36632892` / `br-quiet-sunset-b4xx4pnx` / `neondb`。
來源：GitHub [Draft PR #2](https://github.com/Naos2w/Naosledge/pull/2)，以 PR #1 開發分支為基底。

## 實際執行與結果

1. **遷移前讀取確認**：Sandbox `public.posts`、`public.blog_admins` 存在、RLS 啟用；`knowledge_notes`、`knowledge_links`、`knowledge_publication_sources` 都不存在，Sandbox 文章、管理員與 Auth user 為 0 筆。Neon Production 不作寫入。
2. **獲得 Owner 這次明確授權後**，對 Sandbox 使用 `run_sql_transaction` 將原 `002_private_knowledge_vault.sql` 依正確的 PostgreSQL statement 邊界執行，**39 項初始 DDL/RLS/ACL 在單一交易中成功**，原有 `001` 不重跑。
3. 後驗：三張表啟用 RLS，政策數分別為 4、3、3；私人文章倒排搜尋索引、owner 索引及 backlinks 索引存在；匿名角色不能執行任何私人 Vault RPC。
4. **真實 Neon 驗證發現並修復一次權限差異**：`auth` schema 為 Neon 的 `cloud_admin` 管理，專案角色無法有效授予 `authenticated` schema USAGE。因而最初直接從 `SECURITY INVOKER` RPC 呼叫 `auth.user_id()` 時回應 403 / SQLSTATE 42501。本地 PGlite 模擬的 auth schema 權限與真實 Neon 不同，故本機測試無法預先發現。
5. Sandbox 專屬補丁：建立 `public.vault_current_user_id()`，**唯一的 `SECURITY DEFINER` 身分 Helper**，只執行 `SELECT auth.user_id()`，不接受使用者輸入、動態 SQL 或任意使用者 ID。清除其對 PUBLIC/anonymous 的預設 EXECUTE，只允許 authenticated 執行。四個其他私人 RPC 仍是 **SECURITY INVOKER**，透過此 Helper 取得已驗證 JWT Subject。三張表的 Owner Default 與十項 RLS policy 也改為使用該 Helper；`knowledge_links` 未使用的 UPDATE GRANT 已移除。以上補丁在 Sandbox **同一交易**執行，並同步回 `002` 原始 SQL 以便未來全新環境套用。
6. PGlite 已用修正版完整 `001+002` 通過 RLS／Helper／RPC／索引測試；真正 Neon 的角色檢查亦確認：authenticated 能執行受控 Helper、anonymous 不能，`auth` schema 的 anonymous／authenticated USAGE 仍為 false。
7. **真實 API E2E 全部通過**：使用單次程式執行期間存在 RAM 的隨機合成 `@example.com` 帳號／密碼與 Neon 官方 Session Cookie/JWT；暫時只將兩個合成站長 ID 授權進 Sandbox `blog_admins`，第三個為一般使用者。測試匿名禁止讀私人表、非站長禁止執行 RPC、兩位不同站長隔離、私人筆記 Create/Read/Update、`[[WikiLinks]]`/Backlinks、Atomic Rewrite、中文 substring／英文全文搜尋，以及從私人筆記產生獨立的 `posts.status=draft` 公開草稿；匿名和一般使用者無法讀取該草稿或私人映射。
8. **MSI Chrome／Next.js 真實網站 E2E 最終成功**（獨立本機伺服器、真實 Sandbox Auth/Data API）：匿名與非站長會被拒絕、站長可登入 Private Vault、透過真實 Server Action 新增兩篇私人筆記、點擊 Wikilink、確認 Outgoing + Backlinks、中文搜尋能找到兩篇指定筆記、第二位合成站長完全無法讀取第一位的筆記（直接連結 404），以及從私人筆記建立待審核的未發布文章草稿（匿名 404）。`NEON_VAULT_BROWSER_SUCCESS`、`SANDBOX_KNOWLEDGE_E2E_PASS`、`exitCode=0`。測試過程中曾有預期筆數斷言過於嚴格（同一輪的 API fixtures 也符合搜尋／列表），已修成以指定筆記 ID 驗證隔離並重新跑至 PASS，非資料外洩。
9. **清理完成**：測試程式透過已簽發 JWT 刪除自己建立的私人筆記、關聯／公開副本，另一階段透過 Sandbox DB Owner 撤銷臨時管理員授權、Neon Connector 刪除全部合成 Auth 帳號。最後資料庫唯讀 SQL 確認 `knowledge_notes=0`、`knowledge_links=0`、`knowledge_publication_sources=0`、`posts=0`、`blog_admins=0`、`neon_auth.user=0`、`neon_auth.account=0`、`neon_auth.session=0`。
10. **Production 安全邊界**：獨立唯讀查核 Production 仍沒有新增三張私人知識表，`posts=0`、`blog_admins=0`、原先的一個正式 Auth 使用者仍存在。沒有更改正式 Auth 政策、真實站長權限、Vercel 設定，也沒有新建付費 Neon 分支或服務。

## 重現方式與注意事項

- 本機離線：`npm run test:unit`、`npm run typecheck`、`npm run build`、`npm run test:browser:local`。
- 真實 Sandbox 腳本（**必須有另行授權、不得排入 CI**）：`scripts/verify-knowledge-sandbox.mjs`，明確指定 `NAOSLEDGE_KNOWLEDGE_E2E_ALLOW=br-quiet-sunset-b4xx4pnx` 及 `NAOSLEDGE_NEON_BRANCH_ID=br-quiet-sunset-b4xx4pnx`；如要另外附加 Chrome，設定 `NAOSLEDGE_KNOWLEDGE_WEBSITE_BROWSER=1`。
- 腳本已將 API host 與 Neon Sandbox ID 寫死比對，會在沒有明確 opt-in、CI 模式或分支錯誤時拒絕；臨時憑證只留在 Node 記憶體，**不得輸出、保存或轉貼**。
- 腳本在等待站長權限時只印合成 user ID，**必須由已核准的 Neon Sandbox DB Owner 按本次已確認的合成 Email+ID 精準授權**；角色 grants 與刪除合成 Auth users 要用 Neon 管理工具收尾，不能單靠程式結束認定完全清理。
- Sandbox 已存在 `002` Schema；此 Migration **不能在同一個分支無條件重跑**。只有在新環境中且已確認無三張新表時才能套用。同樣**不應直接套用至 Production**，仍需獨立審查與授權。

## 仍未完成（不能因 Sandbox 通過就忽略）

- PR #2 保持 Draft，不合併 PR #1 或 main；本分支的 Vercel 自動部署已關閉，尚未做受 Vercel Auth 保護的真正線上 Preview／iPhone Safari 驗收。
- Production Auth 的本人 Email 驗證、正式密碼設定、安全註冊策略與真實站長授權尚未完成。
- 大量中文筆記的高效全文倒排索引、完整 Knowledge Graph UI、AI Embeddings/問答、Obsidian 自動雙向同步／備份政策留待後續里程碑。
- **下一關卡**：用本次 Sandbox 實體證據檢查 Production Migration/部署的風險與回復計畫；只有 Owner **另外明確授權**才可對 Production 套用 `002` 或把 Private Vault 發布到線上。
