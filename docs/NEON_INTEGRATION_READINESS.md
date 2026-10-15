# Naosledge → Neon Free · 隔離分支驗收報告

更新：2026-10-15。**這份報告的所有資料庫寫入，僅限使用者明確核准的 Neon「Naosledge」隔離測試分支。** 不代表正式網站已部署或正式站長已啟用。

## 專案與已核准的隔離範圍

| 項目 | 事實 |
|---|---|
| Neon 專案 | `Naosledge`，`bitter-silence-36632892` |
| Free 方案 | `free_v3`，帳號顯示可用分支上限 10，目前 2 個分支 |
| Region | AWS `us-east-2`（Ohio，美國；台灣訪客延遲尚待實測） |
| 原始預設分支 | `production`，`br-aged-sound-b43h5r2c`，**全程未修改** |
| 獲准測試分支 | `naosledge-integration-sandbox-20261015`，`br-quiet-sunset-b4xx4pnx` |
| 資料庫 | `neondb`，PostgreSQL 18.6 |
| 管理登入 | Neon Managed Better Auth |
| 測試 Data API | **active**，僅暴露 `public` schema，JWT provider = Neon Auth |
| 自動授權選項 | 建立 Data API 時使用 `add_default_grants: false`；權限由受審查 SQL 明確授予 |

Neon Free 不允許用 API 在建立分支時自訂休眠時間：第一次呼叫被 HTTP 412 拒絕，已核對未建立分支；第二次改用免費方案預設 Compute 設定，成功建立以上唯一隔離分支，`default=false`，`primary=false`，父分支為上述 `production`。**沒有升級、開通付費資源或異動任何 Supabase 專案。**

## 隔離 Neon 分支上已完成的操作

1. 已使用唯讀方式核對隔離分支 `public` 原先有 0 張表；原本 `neon_auth` schema 是 Neon 管理的 Better Auth 資料，未做手動修改。
2. 僅於隔離分支啟用 Data API，確認 `anonymous`、`authenticated` 角色均不具 `BYPASSRLS`，`auth.user_id()` 函數存在且回傳 `text`。
3. 將 `neon/migrations/001_initial_blog.sql` 在隔離分支以 **21 個 SQL 語句作為同一個資料庫 transaction** 套用成功；建立 `public.posts`、`public.blog_admins`、索引、trigger 及明確 GRANT/RLS。
4. 實際查核兩張表的 `relrowsecurity=true`，`blog_admins` 有 1 項 RLS policy、`posts` 有 5 項 policy。匿名僅對 posts 有 SELECT 授權；已登入使用者對 posts 有 SELECT/INSERT/UPDATE/DELETE，但行級寫入仍需站長身份和作者身分。
5. 在本機 MSI 執行 `scripts/verify-neon-sandbox.mjs`，**真正呼叫這個隔離分支的 Neon Auth 與 Data API**。測試帳號和密碼都是臨時合成資料，未使用真實站長 Email/密碼。

### 真實 Neon Auth／JWT／Data API 端到端驗證結果

- **PASS**：`/token/anonymous` 成功簽發真正的匿名 JWT；可讀公開文章 API，讀取 `blog_admins` 回 403／42501。
- **PASS**：在隔離 Better Auth 註冊兩個 `@example.com` 合成帳號，透過 session cookie 的 `get-session` 取得**真實簽發的 JWT**，並核對 JWT `sub` 與各測試用戶 ID 一致。
- **PASS**：一般登入帳號的新增文章請求被 403／42501 拒絕，也不能透過 API 讀取其他人的站長授權。
- **PASS**：只在隔離分支以資料庫 Owner 權限設定合成站長 `blog_admins` 會員，並由其 JWT 查回自己的授權。
- **PASS**：合成站長能透過真實 Data API 建立 `draft`，PostgreSQL 自動使用登入者 ID 作為 `author_id`。
- **PASS**：對匿名讀者及一般登入帳號，該草稿都不可見；合成站長能讀到。
- **PASS**：一般登入帳號無法修改草稿；站長無法把文章的 `author_id` 改為其他帳號。
- **PASS**：站長發布後，匿名與一般讀者均可讀；站長刪除後，匿名再次查詢已不可見。
- **PASS**：MSI 腳本退出碼 `0`，最終訊息 `SANDBOX_SMOKE_SUCCESS`。腳本不會輸出臨時密碼、Session Cookie 或 JWT。

**清理已完成並以線上 SELECT 核對：**`posts = 0`、`blog_admins = 0`、匹配臨時命名的 `neon_auth.user = 0`。兩個合成 Auth 帳號已由 Neon Connector 刪除，臨時站長授權也已刪除。僅保留**已授權的隔離分支與空白應用表／RLS**，方便未來後續驗證。沒有刪除整個測試分支，因為保留供後續工作；未經額外授權不會對 `production` 套用。

### 與正式分支的最後比對

- `production` 仍是預設分支，`public` **0 張 Naosledge 應用表**；沒有啟用正式分支 Data API 或套用任何 Migration。
- 既有 Supabase 的 Mushroooooms、Go Travel 等專案未變更。
- Neon Auth 原本允許公開註冊且不強制 Email 驗證，**production 仍維持原狀**；正式上線前需經 Owner 核准後設定安全註冊政策。

## 原始碼狀態與 SDK

- `neon/migrations/001_initial_blog.sql`：隔離測試分支成功驗證的正式候選 SQL；不等於已批准生產套用。不得直接套用至 Supabase。
- `lib/neon/data-api.ts`：尚未接入正式網站的獨立 PostgREST adapter，使用 `@neondatabase/postgrest-js`；單元測試使用假 JWT/HTTP。
- `tests/neon-rls.test.mjs`：使用本機 PGlite 模擬角色/RLS 的獨立回歸測試；與上述**真實線上**驗收互補。
- `scripts/verify-neon-sandbox.mjs`：供受控人員**手動**執行的隔離 Auth + JWT + Data API 測試，不接入 GitHub CI，硬性核對核准分支 ID 與 Sandbox API 端點。需透過 Neon Connector 對腳本輸出的合成 Owner ID 授予暫時的 `blog_admins`，並於測試後清除。
- Neon `@neondatabase/auth@0.6.0-beta` 曾在 MSI 以標準 npm 安裝重試**成功**，但出現 Better Auth 同系依賴的 peer version 警告。由於目前網站尚未切換登入，**已從專案依賴移除**，避免在 CI 增加約 201 個未使用的相依套件。正式接入時應先確認官方 SDK/依賴相容性及 SSR cookie 安全。
- 正式網站目前的 `/login`、`/studio` 仍使用 Supabase SDK；**Neon 並未接管網站登入或 Server Actions**，正式站長尚未建立。

## 下一階段需要 Owner 確認的項目

目前隔離資料庫本身已通過真實 Auth／JWT／RLS／CRUD 測試；剩下的是**網站正式接入 Neon、正式管理員身分與發佈流程**。

1. **程式切換**：批准讓 Next.js 在原 Draft PR 中由 Supabase Auth/Server Actions 改為 Neon Auth/Data API；先連**現有隔離分支**做本機瀏覽器實測，不發佈到 Vercel。
2. **正式安全設定**：在取得獨立批准後，才能處理 Neon `production` 的資料庫 Migration、啟用 Data API、停用公開註冊、Email 驗證策略與真實站長身分設定。
3. **正式上線**：真正站長帳號、Cookie Secret、網站 HTTPS 網域與 Vercel 環境變數都需安全設置；未經再次批准不合併 PR 或公開部署。
4. **成本與區域**：維持 Free，任何超出免費方案的變更需另行批准；若要求亞洲地區，必須先評估遷移成本及停機影響。

不得在聊天、PR、CI、Git Commit 中披露密碼、JWT、Session Cookie、OTP、連線字串或 Service Role Secret。

## 官方文件

- https://neon.com/docs/auth/branching-authentication
- https://neon.com/docs/auth/quick-start/nextjs-api-only
- https://neon.com/docs/data-api/get-started
- https://neon.com/docs/data-api/access-control
- https://neon.com/docs/auth/production-checklist
