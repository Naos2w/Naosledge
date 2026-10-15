# Naosledge v3 — 正式上線前置與驗收清單

更新：2026-10-16。**Neon Production 已完成 Data API 與 Migration，並有一個尚未驗證 Email、尚未設定密碼的 Owner Auth 帳號；管理員授權仍為 0。** Auth 安全政策、網站 Production 模式、Vercel 部署仍待核准。PR #1 保持 Draft。本文件是狀態與後續驗收清單，不是其他操作的授權。

## 實際狀態（先核對，再決定下一步）

| 範圍 | 已確認狀態 |
|---|---|
| 原始碼 | [GitHub PR #1](https://github.com/Naos2w/Naosledge/pull/1)，分支 `feat/initial-v3-site-20261015`；尚未合併 `main` |
| MSI 工作目錄 | `C:\Naos\02.Git\personal\Naosledge` |
| 網站 | Next.js 16、Dark Liquid Glass、文章／搜尋／標籤／日曆、Markdown 閱讀與 Studio 編輯已完成 |
| 本機／CI | 本機單元測試、TypeScript、正式建置與 Chrome 回歸已通過；GitHub Actions [Run #38722751700](https://github.com/Naos2w/Naosledge/actions/runs/38722751700) 成功 |
| Neon | 獨立 `Naosledge` Free 專案（`bitter-silence-36632892`，AWS `us-east-2`，PostgreSQL 18） |
| Sandbox | `naosledge-integration-sandbox-20261015`（`br-quiet-sunset-b4xx4pnx`）；`posts`／`blog_admins`、RLS、Data API 及真正的 Auth／JWT／Next.js Chrome CRUD 已驗收 |
| Production | 預設 `production`（`br-aged-sound-b43h5r2c`）；Data API **active**、`public.posts` / `blog_admins` 已建立、RLS 6 項；兩張表均 **0 筆** |
| 正式帳號與網域 | Neon Auth 已建立 1 個待啟用的 Owner 帳號（未驗證 Email、密碼尚未設定）；`blog_admins=0`；Vercel Preview／Production 尚未部署 |
| 舊 Supabase | 僅作為程式回退路徑；既有 Mushroooooms、Go Travel 專案不得更動、共用或重用密鑰 |

Sandbox 使用合成帳號與文章測試後已清理。**2026-10-15 另經 Owner 明確授權**，對指定 Neon Production 套用與 Sandbox 相同的初始 SQL 並啟用 Data API；已由資料庫唯讀查證 RLS／GRANT／索引與空表。**Production 仍未執行真實站長／瀏覽器端到端驗收，也未開站。** 詳細記錄見 [Neon 整合報告](NEON_INTEGRATION_READINESS.md) 和 [QA](../QA.md)。

## 現階段可執行的工作（不需要 Owner 介入）

1. 在既有 PR 開發分支修正程式、測試、文件與部署前檢查，維持未合併狀態。
2. 在 MSI 執行**不碰真實資料庫**的離線單元／PGlite RLS 測試、型別檢查、建置及假 Supabase 的本機 Chrome 回歸。
3. 只讀核對 PR、CI、Neon Sandbox／Production 中繼資料、Data API 有無啟用及資料表有無建立。
4. 更新 PR 說明，保留可重現的非秘密驗證證據；不得在 PR、Commit 或 CI 放入 Token、Cookie、密碼、連線字串。

安全離線驗證：

```powershell
npm ci --include=dev --no-audit --no-fund
npm run test:unit
npm run typecheck
npm run build
npm run test:browser:local
npm run test:browser:neon-recovery:local
```

`npm run test:unit` 已包括 `tests/neon-rls.test.mjs` 的**本機 PGlite 模擬**。本機 Chrome 腳本使用綁定 127.0.0.1 的合成服務，**不是**真實 Neon 生產權限驗證。真正 Neon Sandbox 的 `npm run verify:neon:sandbox:manual` 需要事先核准並以合成帳號執行及清理，**不可自動加入 CI，也不需要為了日常回歸重跑**。

## 密碼設定流程：目前僅具備 Sandbox 前端／離線驗證

- 既有 Production Auth 帳號不能因為已建立而認定可以登入；目前 Email 尚未驗證，且沒有密碼與站長權限。
- 已在 Draft PR 加入 `/forgot-password` 和 `/reset-password`：Neon Better Auth 負責寄送一次性重設連結、驗證 Token、更新密碼；本網站不會自行簽發 Token 或儲存密碼。
- 現有實作**硬性限定 Neon Sandbox 與 `http://localhost`**。`npm run test:browser:neon-recovery:local` 是無實際帳號、無寄信、無 Auth API/資料庫請求的 Chrome UI 安全回歸；不能用此證明正式 Email 收信或重設成功。
- **正式帳號啟用的後續順序：** 由 Owner 決定正式 HTTPS 網址與可信預覽部署；另核准 Auth 安全政策（建議關閉公開註冊及強制 Email 驗證）；在受控 HTTPS 網站實測密碼重設信和本人信箱驗證；驗證成功後再由受控 Owner 權限將經確認的 `neon_auth.user.id` 加入 `public.blog_admins`。
- **密碼重設不等於信箱驗證**：必須另行確認 `emailVerified=true`，且完整測試管理員 Session／RLS。沒有正式網址、Cookie Secret 或明確授權前，不能擅自啟用 Production 網站或對使用者寄出真正的重設信。

## 需要 Owner 明確授權的關卡

**關卡 1 — 正式 Neon 資料庫：已完成（2026-10-15）。** Owner 另行核准了 Neon `Naosledge` Free 專案的 `production`（`br-aged-sound-b43h5r2c`）啟用 Data API（Neon Auth，`public` schema，`add_default_grants=false`）及執行同一份已驗證的 `neon/migrations/001_initial_blog.sql`。21 項 SQL 在單一交易中成功，已唯讀核對兩張表均 RLS enabled、6 項 policies、角色 GRANT 與 0 筆應用資料。未建立快照（確認目前無排程與既有 Snapshot）；變更是無舊應用表上的建立操作，未進行破壞性資料修改。正式 Auth／網站端到端權限測試尚待後續關卡。

**關卡 2 — 正式 Auth 安全政策與站長：部分完成。** 已依 Owner 指定的 Email 在正確 Production 分支建立**一個 Neon Auth 帳號**；唯讀核對 Email 未驗證、Credential 的密碼仍為空、`blog_admins=0`，**不能登入或發布**。Neon Managed Better Auth 仍允許公開註冊，且不強制 Email 驗證。正式上線前要由 Owner 核准關閉公開註冊、要求 Email 驗證／確認寄信政策，並在可信 HTTPS 網站由本人完成密碼設定及信箱驗證。只在身分驗證完成後，才可用真實 Neon Auth `user.id`（轉文字）授權 `public.blog_admins`；不得自行推定本人已通過驗證。

**關卡 3 — 正式網站程式設定。** **現有程式的 Neon 模式仍硬性限定已核准的 Sandbox branch 與端點；不能只把 `.env` 換成 Production URL 就部署。** 在 PR 開發分支可以準備受審查的生產設定方案，但在正式 Auth 安全政策、Owner 站長身分及另行授權前，不啟用、使用或部署 Production 站點；需要確認正確 Auth/Data API 端點、Cookie Secret 與失敗時關閉行為。保持 fail-closed，避免預設連到錯誤資料庫。

**關卡 4 — 網域與 Vercel。** Owner 指定正式 HTTPS 網域、正確的 Vercel Team/Scope，並以服務端環境變數介面安全設定專屬憑證。Preview 部署與 Production 發布**分開核准**；Preview 也不得帶入未獲許可的真實後台、資料或密鑰。沒有合法的 `NEXT_PUBLIC_SITE_URL`，網站 SEO 刻意輸出拒絕索引／不產生正式 Sitemap，不能用假的網域繞過。

**關卡 5 — PR 合併與對外發布。** 完成 Preview 安全驗收後，再由 Owner 核准將 Draft PR 改為 Ready／合併 `main`，以及正式對外部署。CI 成功不等於網站完成上線。

**關卡 1 已獲新的、僅限 Migration 與 Data API 的明確授權且完成；關卡 2–5 不在該授權範圍。** 不得因此擅自處理真實帳號、站長授權、正式 Auth 安全設定、網域、Vercel 或 PR 合併。

## 待核准的 Neon 正式環境設定（僅為欄位清單）

目前範例 `.env.example` 是**本機 Sandbox 專用配置**，不要直接用於 Production。將來正式程式審查通過後，才依其配置契約設定：

- `NAOSLEDGE_BACKEND`／`NEXT_PUBLIC_NAOSLEDGE_BACKEND`：後端模式必須一致。
- `NAOSLEDGE_NEON_BRANCH_ID`：正式分支 ID；必須由生產模式的獨立檢查明確允許。
- `NEON_AUTH_BASE_URL`、`NEON_DATA_API_URL`：與**相同且正確的**正式 Neon 分支配對；不得混用 Sandbox URL。
- `NEON_AUTH_COOKIE_SECRET`：伺服器專用、高熵隨機秘密，透過 Vercel Secret/Environment Variables 設定，**不可**加上 `NEXT_PUBLIC_` 前綴。
- `NEXT_PUBLIC_SITE_URL`：經核准的正式 HTTPS 網域根目錄，不得是 localhost、測試網域或占位字串。

實際欄位和行為仍以**日後獲核准且已測試的正式程式版本**為準；此清單不代表 Production 模式目前已實作。不要將密碼、OTP、JWT、Cookie、PostgreSQL URI、API Key 或其他秘密貼到 ChatGPT、GitHub、PR、CI 紀錄。

## 上線後才可進行的真實權限／操作驗收

- 未登入：可讀取**已發布**文章；任何草稿 URL 回 404；無法讀取 `blog_admins`。
- 非站長登入：無法進入 `/studio`、無法新增／編輯／刪除文章，亦無法自行取得管理員授權。
- 正式站長：登入後建立草稿，匿名訪客仍無法看見；發布後可讀；編輯、下架、刪除會正確同步；登出後無法使用原 Session 操作。
- 審查資料庫：RLS 已啟用、政策和 GRANT 與測試一致、沒有誤用 Service Role／Database Owner 特權，必要的 Auth 註冊政策已啟用。
- 檢查 SEO、Sitemap、公開分享資訊、HTTPS/Cookie、快取、手機窄版與鍵盤無障礙，必要時由 Owner 在實體 iPhone Safari 驗收。
- 檢查 Neon Free 使用量、連線延遲（目前 AWS Ohio，台灣訪客延遲尚未實測）、Vercel 用量與回復方案。

`npm run verify:anonymous` 是**原 Supabase 路徑**的只讀腳本，不可拿它當 Neon Production 的安全驗收證據；Neon 正式版須使用適用於正式模式、經核准的獨立驗證流程。

## 回復與成本邊界

保持 Free：不得自行升級方案、遷移區域、停用或改變既有 Supabase 專案，也不得刪除 Neon 分支。尚未發布就**沒有網站可回滾**；正式發布後，應優先準備可回退的應用版本和資料庫保護／快照計畫，避免將刪資料表當作預設回滾手段。

第一階段限公開部落格、筆記管理與 Markdown 編輯；AI 自動整理留待第二階段。
