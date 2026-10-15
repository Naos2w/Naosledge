# Naosledge · 上線前置與驗收清單

更新：2026-10-15。本站是**完全公開的學習部落格**，但**草稿與站長後台絕不可公開**。此文件只用於新建 Naosledge 專用服務，不得把 SQL 執行在 Mushroooooms、Go Travel 或其他專案的資料庫。

## 目前已完成

- GitHub: [Naos2w/Naosledge](https://github.com/Naos2w/Naosledge)，開發 PR #1
- MSI 本機：`C:\Naos\02.Git\personal\Naosledge`
- Node.js 24、`npm ci --include=dev`、`npm run typecheck` 與 `npm run build` 已成功
- 專屬 Supabase 專案、正式站長帳號、Vercel 部署 **尚未完成**

## 新建 Supabase 專案：需要確認的事情

1. 先取得使用者確認要放在**哪個 Supabase 組織**。目前可見名稱為 `Naos`；不得直接假設已獲准。
2. 使用 Supabase 官方成本查詢，將**實際價格和計費週期**交給使用者確認；沒有完成費用確認前，不建立專案。
3. 為新專案選擇適合台灣訪客的區域。可優先評估 `ap-southeast-1`（新加坡），但不得以現有專案區域取代確認。
4. 不複用其他 Supabase 專案、資料庫、帳號或環境變數。

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

本專案第一階段只包含公開部落格、筆記管理和 Markdown 編輯。**AI 整理留待第二階段**。預覽或 CI 通過不代表資料庫已驗收。任何有額外付費可能的操作、建立或重設真實站長登入資訊、正式公開部署，都需要可追溯確認。
