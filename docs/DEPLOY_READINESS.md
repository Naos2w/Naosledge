# Naosledge · 上線前置與驗收清單

更新：2026-10-15。本站是**完全公開的學習部落格**，但**草稿與站長後台絕不可公開**。此文件只用於新建 Naosledge 專用服務，不得把 SQL 執行在 Mushroooooms、Go Travel 或其他專案的資料庫。

## 目前已完成

- GitHub: [Naos2w/Naosledge](https://github.com/Naos2w/Naosledge)，開發 PR #1
- MSI 本機：`C:\Naos\02.Git\personal\Naosledge`
- Node.js 24、`npm ci --include=dev`、`npm run typecheck` 與 `npm run build` 已成功
- 專屬 Supabase 專案、正式站長帳號、Vercel 部署 **尚未完成**
- 2026-10-15 使用者已同意在 Supabase **Naos** 組織、Singapore（`ap-southeast-1`）建立專案；成本工具當時回報建立費用 **$0/月**。但 Supabase 建立請求因 **2 個免費活躍專案的額度上限**失敗，未建立任何 Naosledge 資料庫。
- 現有活躍專案為 Mushroooooms、Go Travel；使用者已決定**繼續使用免費方案，不停用或更動現有專案**，本階段只允許無資料庫開發與測試。
- 後續如要新建資料庫、搬遷、暫停專案或升級付費，須先取得新的明確授權；不得沿用之前建立失敗時的費用核准自行重試。
- **新決策（2026-10-15）**：使用者已自行建立獨立的 **Neon「Naosledge」Free 專案**。目前只做了讀取狀態的檢查；分支 `production`、資料庫 `neondb`、Better Auth 和 Storage 已存在，`public` 應用表仍為 0、Data API 尚未啟用。**現有正式站程式仍是 Supabase SDK，沒有切換 Neon，也沒有雲端 Migration。** Neon 的完整測試／權限與待授權項目詳見 [`NEON_INTEGRATION_READINESS.md`](NEON_INTEGRATION_READINESS.md)。

## Supabase 資料庫啟用：目前暫停

目前**不可重試建立**：使用者決定先維持免費，且不動現有 Supabase 專案。未來如條件改變，先再次確認新專案組織、區域、當時的實際費用與限制，再取得使用者同意。絕不能借用其他產品的資料庫、帳號或環境變數。

## 下一個真正需要 Owner 決策的關卡

已完成的無資料庫功能包含 Dark Liquid Glass UI、行動導覽、Markdown 文章閱讀／圖片／目錄、程式碼複製、站長編輯器與本機 Markdown 備份。離線測試使用合成帳號與資料，**不能據此宣稱線上正式資料庫已驗收或公開網站已上線**。

使用者已選擇建立 **Neon Free 專案作為同樣免費的獨立後端**，不再需要在「繼續等 Supabase」和「改 GitHub 靜態網站」之間重新二選一。下一個需要 Owner 明確允許的範圍是：**只在新 Neon 專案建立可辨識、非 `production` 的隔離測試分支；在該分支啟用 Data API，套用 `neon/migrations/001_initial_blog.sql` 並寫入合成測試資料，以驗證 Better Auth JWT、RLS 和文章 CRUD**。

上述任何雲端寫入都尚未獲得此次專用測試分支的具體授權，因此維持停止。**正式 `production` 分支、現有 Supabase、真實站長帳號、網域／部署以及 PR #1 合併**也都不在測試分支授權範圍內。PR 保持 Draft，保持免費和可還原。

## 離線驗證（可以立即執行，無資料庫依賴）

```powershell
npm ci --include=dev --no-audit --no-fund
npm run test:unit
npm run typecheck
npm run build
```

此外已用 PGlite 於本機執行尚未套用的 Neon migration 與合成帳號 RLS 權限測試（`npm run test:neon:rls`）；此結果只證明離線 PostgreSQL RLS 邏輯，**不能代表 Neon 真實 JWT 驗證、線上登入或文章發布已通過**。

## 站長帳號：使用者操作

專案建立後，使用者自行在該專案的 **Authentication → Users** 建立站長帳號，並在該專案設定關閉公開註冊（Disable sign ups）。**不要把密碼、OTP、Recovery codes 或 Service Role Secret 貼進聊天、GitHub、PR 或 CI 日誌。**

取得站長 UUID 後，在**新建且確認正確的 Naosledge 專案**套用 `supabase/schema.sql`，再以受控 SQL 加入 `public.blog_admins`，例如：

```sql
insert into public.blog_admins (user_id) values ('THE-OWNER-UUID');
```

請務必從新專案的 Auth → Users 核對 UUID，不使用猜測值。

## 設定環境變數

從專用 Supabase 專案取得 API URL 與 **publishable key**；只允許這些前端可公開的設定：

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
NEXT_PUBLIC_SITE_URL=https://YOUR_DEPLOYED_DOMAIN
```

本機把設定放在 Git 忽略的 `.env.local`；Vercel 用專案環境變數管理。不要使用 `service_role`、`sb_secret_`、站長密碼或他人專案金鑰。

**SEO 上線條件（2026-10-15）**：`NEXT_PUBLIC_SITE_URL` 必須設定為經使用者確認的**正式 HTTPS 網域根目錄**。沒有符合條件的網址時，Naosledge 會回覆 `robots.txt Disallow: /`、不發布可索引的 Sitemap／canonical／JSON-LD。這是避免在開發期誤收錄的刻意設計；若未來真的部署，必須先完成網域、專屬資料庫與真實權限的完整驗收。切勿僅為了讓 sitemap 非空而填入不存在或不屬於你的網址。

## 線上權限驗收（必做，不可只看 CI 成功）

1. 用未登入瀏覽器讀公開首頁、文章頁；必須僅能看到 `published`。
2. 用站長登入，在後台建立一篇測試草稿，並保持 `draft` 狀態。
3. 以**未登入的私人瀏覽視窗**開啟該草稿的 `/notes/<slug>`，應為 404，公開文章 API 不可讀到該筆資料。
4. 站長將另一篇測試文章發布，未登入訪客可以讀到；再編輯、下架／刪除，驗證權限與同步。
5. 使用非站長身份登入，必須無法進入 `/studio` 或修改任何文章。
6. 專用資料庫的 Supabase Security / Performance Advisors 不應有未處理的重大問題。
7. 在本機有 `.env.local` 且可連線時執行 `npm run verify:anonymous`。若設置 `NAOSLEDGE_DRAFT_TEST_SLUG`，可以額外確認指定草稿對匿名訪客不可見。此測試只讀取資料，**不會修改資料庫**；匿名測試通過也不等於已驗證站長寫入權限。
8. 檢查手機瀏覽、鍵盤焦點、文章 SEO／Sitemap、登入錯誤提示、深色預設與減少動畫偏好。

## Vercel 預覽／正式部署

- 先連接 GitHub 倉庫到正確的 Vercel Team/Scope；設定 **Naosledge 專用**環境變數，確認 Preview 階段成功後才啟用公開正式站。
- 未設定 Supabase 專用 URL 與 key 的 Vercel 部署，即使 `next build` 成功，執行時仍可能讀不到文章／無法登入，不能報告為「網站已上線」。
- 分支 PR 預覽核准、資料庫授權驗收與部署環境確認後，才進行 `main` 合併及 Production 發布。

## 發布邊界

本專案第一階段只包含公開部落格、筆記管理和 Markdown 編輯。**AI 整理留待第二階段**。預覽或 CI 通過不代表資料庫已驗收。任何有額外付費可能的操作、建立或重設真實站長登入資訊、正式公開部署，都需要可追溯確認。**2026-10-15 的最新決策是保持免費、禁止任何現有 Supabase 專案變更；只做無資料庫的開發測試。**
