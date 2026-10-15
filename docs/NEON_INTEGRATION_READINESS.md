# Naosledge → Neon Free：整合前置與隔離驗收

更新：2026-10-15。本文件是**已連線的 Neon 新專案**的唯讀查核與本機 Migration 設計證據，不代表已部署或完成線上整合。

## 本次 Neon 唯讀查核

- 使用者已建立 **Naosledge** Neon 專用專案，隸屬免費組織（Free v3）。本專案與 Mushroooooms、Go Travel 等 Supabase 服務沒有共用資料庫。
- Region：AWS `us-east-2`（Ohio，美國）。主要使用者在台灣時，之後需驗收跨區延遲；目前**不擅自建立或遷移到新加坡新專案**。
- 預設分支：`production`（ready，**未受保護**）；資料庫：`neondb`，PostgreSQL 18.6。
- `public` 的應用資料表：**0**；`neon_auth` 有 Better Auth 管理的內部資料表，**不得更動**。
- Managed Better Auth：已啟用。Email／密碼登入已啟用，但**目前允許公開註冊且未要求驗證信箱**；單一站長部落格上線前必須修正。
- Neon Storage：enabled，Bucket 目前為 0；Neon Data API：尚未啟用，讀取時回覆 `data api not found`。
- 目前沒有修改上述任一雲端設定、憑證、資料表、分支，也沒有查詢或複製秘密值。

## Supabase 與 Neon 關鍵差異

| 範圍 | 舊程式（Supabase） | Neon Free 預計實作 |
|---|---|---|
| 認證 | `supabase.auth` / SSR cookie | Neon Managed Better Auth（Next.js server SDK） |
| 資料讀寫 | `@supabase/supabase-js .from()` | Neon Data API / `@neondatabase/neon-js`，正式驗收後才切換 |
| 身分 ID | `uuid` 外鍵至 `auth.users` | Neon Auth `user.id` 視為 `text`，不依賴 `neon_auth` 內部 schema |
| RLS 身分函數 | `auth.uid()` | `auth.user_id()`，回傳 JWT `sub` |
| 公開 PostgREST 角色 | `anon` | `anonymous` |
| 登入角色 | `authenticated` | `authenticated` |
| 公開資料 | 已發布 `posts` | 已發布 `posts`；草稿只允許授權站長 |
| 特權 | 站長由 `blog_admins` 決定 | 同名 `blog_admins`，不得以登入成功、Email 或使用者自訂 metadata 直接當成站長 |

Neon Data API **沒有自身的獨立權限層**；真正的限制來自 SQL GRANT 與 PostgreSQL RLS。不可直接複製 Supabase migration，也不能只更換環境變數就把舊站部署上線。

## 已準備但絕對未套用的 Migration

- 草案檔：`neon/migrations/001_initial_blog.sql`。
- 首次執行條件：**已獲授權的隔離 Neon 測試分支**、`neondb` 的 Neon Data API / JWT provider 已設定、`authenticated`、`anonymous` 角色及 `auth.user_id()` 函數已存在。
- SQL 使用原子 transaction，新增 `posts`、`blog_admins`、文章索引、更新時間 trigger、必要 GRANT 和 RLS。**不包含站長真實 ID、密碼或任何秘密**；管理員要由 Owner 後續確認 user ID 並在受控環境指定。
- 尚未建立 Neon 測試分支，尚未啟用 Data API，尚未執行任何此 SQL。

### 已完成的本機 PostgreSQL 權限測試

`npm run test:unit` 會執行 `tests/neon-rls.test.mjs`，用 `@electric-sql/pglite` 在**本機記憶體**建立獨立 PostgreSQL（不是遠端 Neon）。測試時只模擬 Neon 官方的 `anonymous`、`authenticated` 角色及 `auth.user_id()` 函數，使用純合成使用者和文章。已驗證：

- 專用兩表 RLS 皆 enabled。
- 匿名讀者只可讀已發布文章，不能取得 blog_admins、修改／刪除文章。
- 一般登入讀者仍只能讀公開文章，不能新增／修改／指定自己為站長。
- 站長可讀草稿、建立及修改自己的文章，但不可冒用其他人的作者 ID。
- 資料庫限制會拒絕非法發布日期及過大的文章內容。
- 每次試驗的資料變更用 ROLLBACK 回復；不留下測試文章。

**這些測試不等於真實 Neon Data API、Better Auth JWT 或 PostgreSQL 18.6 線上驗收。** 本機 PGlite 只驗證 SQL/RLS 相容性，網路端 JWT 驗簽與 Auth 仍未測試。

## Neon SDK 目前的注意事項

截至 2026-10-15，官方文件指定 `@neondatabase/auth` 與 `@neondatabase/neon-js` beta SDK。MSI 嘗試以預設嚴格 npm 安裝時，出現 `better-call` 與 Better Auth 的 peer dependency 版本衝突，而且安裝在時間限制內未完成。

**未使用 `--force` 或 `--legacy-peer-deps` 去強制完成有衝突的 Auth SDK 安裝，也未把不確定的 Auth SDK 接到正式登入路由。** 現有 Supabase 介面與程式保持不變。

已另外安裝、釘選**不含 Managed Better Auth 的** `@neondatabase/postgrest-js@0.2.0-beta`，新增 `lib/neon/data-api.ts` 作為**未啟用的** PostgREST 對接層：驗證 Neon HTTPS Data API URL、要求由可靠來源供應的 JWT，缺少 JWT 時拒絕送出資料庫請求。`tests/neon-data-api.test.mjs` 使用合成 JWT 與完全攔截的假 HTTP 服務測試公開文章查詢／UPDATE 的查詢參數，**沒有連線真實 Neon**。實際 Neon JWT 簽發／驗證、SSR cookie 與權限仍待在獲准的測試分支完整驗收。

### 下一階段的環境變數（僅供設計，尚不可設定正式站）

- `NEON_AUTH_BASE_URL`：由 Neon Console 取得的 Managed Better Auth HTTPS URL。
- `NEON_AUTH_COOKIE_SECRET`：至少 32 字元的隨機伺服器 Cookie Secret，**只能存在受控環境設定，不得使用 `NEXT_PUBLIC_`**。
- `NEXT_PUBLIC_NEON_DATA_API_URL`：啟用 Data API 後的公開 HTTPS REST endpoint；網址本身不是 PostgreSQL 連線字串。現階段 Data API 尚未啟用，**不得填入猜測網址**。
- `NEXT_PUBLIC_SITE_URL`：使用者日後核准的正式網站 HTTPS 根網址。

一律不得把 PostgreSQL owner 密碼、Session Secret、JWT、使用者密碼或 Email OTP 放進程式碼、README 或公開 CI 日誌。

## 下一步：需要使用者另外授權的操作

使用者曾要求**保持完全免費、不異動既有 Supabase 專案，且未經明確許可不動 Neon production**。因此以下項目都還未執行：

1. 在專用 Neon **Naosledge** 項目中建立一個**非 production 的隔離測試分支**（例如 `naosledge-integration-sandbox`），只包含目前空白資料庫的快照；先再次核對 Free 方案與所需容量／算力。
2. 只在該測試分支建立或啟用 Neon Data API、受控匿名／登入角色及必要測試環境設定。絕不動 production 或現有 Supabase。
3. 在該隔離分支套用 `001_initial_blog.sql`，用**合成帳號、合成文章**驗收匿名讀取、非站長拒絕、草稿 404、站長 CRUD 和 JWT/RLS；保留 SQL 清冊、前後庫表狀態、測試 exit code 與去敏錯誤碼。
4. 驗收後才決定 Neon Auth / Data API 程式正式切換策略。真正站長帳號、Email 驗證、關閉公開註冊、Vercel 環境變數、網址及是否合併／部署**各自需要授權**。

不提供、索取或複製 Postgres 連線密碼、Cookie Secret、JWT 或 Email OTP。若使用者暫不授權，上述流程維持等待；已完成的本機程式與測試可繼續正常使用。

## 官方參考

- [Neon Auth：Next.js API methods](https://neon.com/docs/auth/quick-start/nextjs-api-only)
- [Neon Data API：Getting started](https://neon.com/docs/data-api/get-started)
- [Neon Data API：Access control / RLS](https://neon.com/docs/data-api/access-control)
- [Neon Auth：Production checklist](https://neon.com/docs/auth/production-checklist)
