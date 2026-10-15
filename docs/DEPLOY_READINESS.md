# Naosledge v3 — 正式上線前置與驗收清單

更新：2026-10-15。**目前僅完成 Neon Free Sandbox 整合驗收；Production 未授權、網站未部署、PR #1 維持 Draft。** 本文件是待核准的執行清單，不是執行授權。

## 實際狀態（先核對，再決定下一步）

| 範圍 | 已確認狀態 |
|---|---|
| 原始碼 | [GitHub PR #1](https://github.com/Naos2w/Naosledge/pull/1)，分支 `feat/initial-v3-site-20261015`；尚未合併 `main` |
| MSI 工作目錄 | `C:\Naos\02.Git\personal\Naosledge` |
| 網站 | Next.js 16、Dark Liquid Glass、文章／搜尋／標籤／日曆、Markdown 閱讀與 Studio 編輯已完成 |
| 本機／CI | 本機單元測試、TypeScript、正式建置與 Chrome 回歸已通過；GitHub Actions [Run #38722751700](https://github.com/Naos2w/Naosledge/actions/runs/38722751700) 成功 |
| Neon | 獨立 `Naosledge` Free 專案（`bitter-silence-36632892`，AWS `us-east-2`，PostgreSQL 18） |
| Sandbox | `naosledge-integration-sandbox-20261015`（`br-quiet-sunset-b4xx4pnx`）；`posts`／`blog_admins`、RLS、Data API 及真正的 Auth／JWT／Next.js Chrome CRUD 已驗收 |
| Production | 預設 `production`（`br-aged-sound-b43h5r2c`）；**尚無 Naosledge 應用表，也未啟用 Data API** |
| 正式站長與網域 | 尚未建立／核准；Vercel Preview 和 Production 都尚未部署 |
| 舊 Supabase | 僅作為程式回退路徑；既有 Mushroooooms、Go Travel 專案不得更動、共用或重用密鑰 |

Sandbox 使用合成帳號與文章測試後已清理。詳細記錄見 [Neon Sandbox 真實整合報告](NEON_INTEGRATION_READINESS.md) 和 [QA](../QA.md)。線上正式環境**沒有**因此通過驗收。

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
```

`npm run test:unit` 已包括 `tests/neon-rls.test.mjs` 的**本機 PGlite 模擬**。本機 Chrome 腳本使用綁定 127.0.0.1 的合成服務，**不是**真實 Neon 生產權限驗證。真正 Neon Sandbox 的 `npm run verify:neon:sandbox:manual` 需要事先核准並以合成帳號執行及清理，**不可自動加入 CI，也不需要為了日常回歸重跑**。

## 需要 Owner 明確授權的關卡

**關卡 1 — 正式 Neon 資料庫。** 確認仍使用獨立 `Naosledge` Free 專案、正式分支 ID、方案限制、區域與費用。經核准後，先檢視 `neon/migrations/001_initial_blog.sql`，再於正確的 `production` 分支套用、啟用其 Data API，逐項驗證 RLS、GRANT、anonymous／authenticated 權限。不得對其他 Neon／Supabase 專案執行 SQL。建議事前制定快照／回復計畫，避免含資料表的破壞式回滾。

**關卡 2 — 正式 Auth 安全政策與站長。** 目前 Neon Managed Better Auth 存在，但原始設定允許公開註冊且未強制 Email 驗證。正式上線前需核准關閉公開註冊及信箱驗證策略；由 Owner 以安全管道建立自己的站長帳號，確認真正的 Neon Auth `user.id`（**文字 ID，不是預設 Supabase UUID**），只在正確的正式資料庫授權 `public.blog_admins`。不能自動猜測身分、替 Owner 建立真實憑證或從聊天輸出敏感資訊。

**關卡 3 — 正式網站程式設定。** **現有程式的 Neon 模式硬性限定已核准的 Sandbox branch 與端點；不能只把 `.env` 換成 Production URL 就部署。** 正式分支核准後，才可在 PR 內設計獨立的生產設定驗證、檢查正確 Auth/Data API 端點、權限、Cookie Secret 和無洩漏規則，並測試後提交。保持 fail-closed，避免預設連到錯誤資料庫。

**關卡 4 — 網域與 Vercel。** Owner 指定正式 HTTPS 網域、正確的 Vercel Team/Scope，並以服務端環境變數介面安全設定專屬憑證。Preview 部署與 Production 發布**分開核准**；Preview 也不得帶入未獲許可的真實後台、資料或密鑰。沒有合法的 `NEXT_PUBLIC_SITE_URL`，網站 SEO 刻意輸出拒絕索引／不產生正式 Sitemap，不能用假的網域繞過。

**關卡 5 — PR 合併與對外發布。** 完成 Preview 安全驗收後，再由 Owner 核准將 Draft PR 改為 Ready／合併 `main`，以及正式對外部署。CI 成功不等於網站完成上線。

上述五個關卡不可沿用先前對**Sandbox**的授權，自動推定 Production 也獲准。

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
