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

## 2026-10-15：Next.js 網站正式改接 Neon Sandbox 的完整驗證

使用者已進一步授權**既有 Draft PR 內的網站後端程式切換測試**。程式新增 `NAOSLEDGE_BACKEND` 與 `NEXT_PUBLIC_NAOSLEDGE_BACKEND`，預設保留原本 Supabase，只有兩者明確同為 `neon` 才進入 Neon 模式，並硬性限制為**已核准的 sandbox branch ID 與 sandbox Auth／Data API endpoint**。任何 Neon production 或其他 branch 的設定會直接被拒絕。

- 使用 Neon 官方 `@neondatabase/auth/next/server` 驗證 Email/Password、HTTP-only Cookie、Session；伺服器透過 Neon Auth `/get-session` 取得官方簽發 JWT，檢查 `sub` 與 Session 身分一致，資料庫 RLS 再獨立驗證 JWT；不自行簽署可供 Data API 使用的身分 token。
- 公開文章走 `/token/anonymous` 取得匿名 JWT，沒有偷用站長 Session；所有 Studio 的查詢／編輯／發文／刪除均使用使用者身份的 JWT，站長權限由 `blog_admins` + Neon RLS 決定，禁止以使用者輸入的 Email 當作權限。
- `components/studio-login.tsx` 的 Neon 登入流程分為**登入設定 Cookie、再次讀取真正 JWT/RLS 進行站長檢查**；無權限帳號會被登出，仍無法進入 `/studio`。
- Next.js `proxy.ts` 以官方 Neon Middleware 處理 `/studio` 認證；登入與新增筆記頁明確採動態 SSR，避免 `next build` 靜態預渲染讀取 Session。
- `scripts/neon-website-browser.mjs` 是受控的真實 Chrome 測試，由 `scripts/verify-neon-sandbox.mjs` 在設定 `NAOSLEDGE_NEON_WEBSITE_BROWSER=1` 時呼叫。測試站只在 MSI `localhost` 啟動，Cookie Secret 每次於本機記憶體隨機生成，不會保存任何登入憑證。

**真實 Next.js + Chrome + Neon Sandbox E2E 結果（exit 0 / `NEON_WEBSITE_BROWSER_SUCCESS`）：**

- 匿名首頁正常，嘗試進入 Studio 會轉址登入頁。
- 真實 Better Auth 合成一般帳號登入後因非站長而被拒絕並登出。
- 合成站長的真正 Cookie Session 可進入 Studio。
- 真實 Next.js Server Action 能建立草稿；未登入訪客看到草稿 404，首頁也不顯示草稿。
- 站長發布後匿名訪客看到 200，更新文章內容後公開頁同步；站長刪除後匿名再次看到 404。
- 登出後無法再次進入 Studio，Chrome JavaScript page errors = 0。
- 另外重新執行原有 Supabase 模式的完整本機 Chrome 回歸；保留向後相容。sandbox-only Neon `next build` 亦已編譯成功，未部署任何網站。

**測試資料清理：**兩個此次建立的合成 Auth 帳號、暫時站長授權與合成文章均已刪除，線上再次查核 sandbox `posts=0`、`blog_admins=0`、synthetic Auth users=0。Neon `production` 仍為 default，`public` 仍然 0 個 Naosledge 應用表。

## 原始碼狀態與 SDK

- `neon/migrations/001_initial_blog.sql`：隔離測試分支成功驗證的正式候選 SQL；不等於已批准生產套用。不得直接套用至 Supabase。
- `lib/neon/data-api.ts`：使用 `@neondatabase/postgrest-js` 的 PostgREST adapter，已接入明確啟用的 Sandbox 網站路徑，且仍保留合成 JWT／HTTP 單元測試。
- `tests/neon-rls.test.mjs`：使用本機 PGlite 模擬角色/RLS 的獨立回歸測試；與上述**真實線上**驗收互補。
- `scripts/verify-neon-sandbox.mjs`：供受控人員**手動**執行的隔離 Auth + JWT + Data API 測試，不接入 GitHub CI，硬性核對核准分支 ID 與 Sandbox API 端點。需透過 Neon Connector 對腳本輸出的合成 Owner ID 授予暫時的 `blog_admins`，並於測試後清除。
- 已重新以標準 npm 安裝並釘選 `@neondatabase/auth@0.6.0-beta`，實測官方 Next.js Server SDK 的 HTTP-only Cookie、Session、signIn／signOut 正常。此 beta SDK 仍有 Better Auth 同系相依的 peer version 警告，**尚需後續追蹤相容與安全更新**；目前僅在本機 Sandbox 模式驗收，不代表可以立即公開部署。
- 正式網站在**預設模式**仍使用 Supabase SDK 作為回退；在**顯式 Sandbox 模式**，`/login`、`/studio`、文章查詢與 Server Actions 都已成功改用 Neon。**Neon production 尚未啟用，也沒有建立真實站長。**

## 下一階段需要 Owner 確認的項目

**網站程式與 Sandbox 完整整合已驗證合格**，不需要重複建立隔離分支或重新討論網站後端選擇。剩下的是**正式環境準備、站長身分、部署**，必須由 Owner 另外批准。

1. **正式 Neon 資料庫**：在取得新的明確授權後，才能對 `production` 套用已驗證的 Migration、啟用 Data API、重新核對 RLS、GRANT 和真正的匿名訪客草稿隔離。
2. **正式 Auth 政策**：安全關閉公開註冊、確認 Email 驗證策略、設定實際站長身分與 HTTP-only Cookie Secret；不得由助理自行建立使用者真實帳號或揭露任何憑證。
3. **正式上線**：真正站長帳號、Cookie Secret、網站 HTTPS 網域與 Vercel 環境變數都需安全設置；未經再次批准不合併 PR 或公開部署。
4. **成本與區域**：維持 Free，任何超出免費方案的變更需另行批准；若要求亞洲地區，必須先評估遷移成本及停機影響。

不得在聊天、PR、CI、Git Commit 中披露密碼、JWT、Session Cookie、OTP、連線字串或 Service Role Secret。

## 官方文件

- https://neon.com/docs/auth/branching-authentication
- https://neon.com/docs/auth/quick-start/nextjs-api-only
- https://neon.com/docs/data-api/get-started
- https://neon.com/docs/data-api/access-control
- https://neon.com/docs/auth/production-checklist
