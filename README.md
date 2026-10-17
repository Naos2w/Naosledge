# Naosledge v3 · Minimal Dark Liquid Glass

一個以 **Next.js** 開發的繁體中文公開學習部落格，採用現代極簡、預設深色的 Liquid Glass 介面，同時維持以閱讀與寫作為中心的資訊架構。文章對訪客公開，**只有站長可以登入、編輯、發布或刪除內容**。現階段可透過環境旗標選擇原本的 Supabase 實作，或已通過隔離驗收的 **Neon Free 測試模式**；網站程式仍預設使用 Supabase 相容回退路徑；Neon Production 的資料表與 Data API 已獲授權建立，但網站 Production 模式尚未啟用。AI 摘要留待第二階段。

> v3 在先前版本的基礎上加入 Dark Liquid Glass 與流暢動畫，保留文章資料結構、Supabase RLS、登入及資料存取邏輯。v1、v2 保留為歷史版本。

## 專案狀態

GitHub 原始碼為可部署的 Next.js 網站，不包含離線 UI 展示用的虛構文章與不需登入的模擬後台。離線互動預覽另存於 ChatGPT 專案成果中，不是正式網站，也不會把筆記寫入 Supabase。

目前已於 MSI 執行 `npm run test:unit`、`npm run typecheck` 與 `npm run build`；尚待 Neon 正式 Auth 安全政策、站長身分、網站 Production 模式及 Vercel 部署。**2026-10-15 Supabase 免費專案名額已滿，使用者選擇維持免費且不影響現有服務**，因此不得建立／共用現有 Supabase 資料庫或擅自升級方案。Neon **隔離分支**已完成真實 Better Auth／JWT／Data API／PostgreSQL RLS 與站長 CRUD 驗證，合成帳號／文章已清除；而 **Next.js 網站已可在 Neon Sandbox 模式下以真正的 Auth／Data API 完成登入、草稿、發布、編輯及刪除**；Neon `production` 已另行獲准建立文章表、RLS 及 Data API（目前無文章或站長授權），正式網站仍未部署。詳見 [Neon 隔離整合驗收報告](docs/NEON_INTEGRATION_READINESS.md) 及 [上線清單](docs/DEPLOY_READINESS.md)。

## P1 + P2：私人第二大腦（獨立開發中）

Naosledge 將從公開學習網站擴展為 **Private-first 第二大腦**。這一階段在獨立分支 `feat/private-knowledge-vault-20261017` 開發，**不是原 PR #1 已上線功能**。新建 `/vault`、`/vault/new`、`/vault/[id]`，以獨立 `knowledge_notes` 保存私人 Markdown，並支援搜尋索引、`[[slug]]`、`[[標題|顯示名稱]]`、雙向反向連結與尚未解析的關係。

- **私人預設**：新表使用 Neon Auth JWT + RLS，只有實際站長能讀取**自己**的私人筆記，匿名和一般登入者無表格／RPC 權限，與公開 `posts` 完全分離。
- **經審核的公開副本**：可明確產生一篇與私人原稿分離的 **status=draft** 文章，需再進入既有 Studio 檢查、手動發布；私人關係與來源 mapping 不會公開。
- **效能與限制**：已有 PostgreSQL `tsvector/GIN` 英文全文搜尋；中文以 Unicode 字串比對作為初期功能（尚非索引化中文搜尋）。互動圖譜、AI 語意搜尋、Obsidian 雙向自動同步留到後續階段。
- **部署邊界**：Owner 已明確核准且在 **Naosledge Neon Sandbox** 套用 `002_private_knowledge_vault.sql`；SQL 與真實 Neon Auth／JWT／RLS／Chrome E2E 都已通過，測試資料清理為 0。**Production 尚未套用 002**。分支 `vercel.json` 仍禁止新分支自動 Preview 部署，避免影響 PR #1 的 Vercel 或耗用未核准額度。
- **測試**：本機 PGlite 權限、SQL RPC、中文搜尋、Wikilinks、公開草稿副本、單元測試、Next.js Build 和舊網站 Chrome 回歸均通過，另外已完成**真實 MSI Chrome + Neon Sandbox** 私人筆記新增、雙向連結、Backlinks、中文搜尋、跨帳號隔離與公開草稿保護驗收。

詳見 [Second Brain 架構規格](docs/SECOND_BRAIN_ARCHITECTURE.md) 與 [Neon Sandbox 實體驗收及清理證據](docs/SECOND_BRAIN_SANDBOX_VERIFICATION.md)。**Sandbox 已驗收完成**；接下來如要套用 Neon Production Migration 或把這個 Vault 部署到正式網域，需 Owner 另行授權，正式站長帳號也尚未啟用。

## v3 視覺與互動設計

| 區域 | v3 行為 |
|---|---|
| 預設主題 | **深色**（墨黑／煙燻玻璃），首次進站不跟隨系統主題；手動切換後記住選擇 |
| 導覽列 | 半透明浮動玻璃、柔和高光、細邊框與保留導覽鍵盤焦點 |
| 首頁 | 黑色背景上的乾淨排版；單一精選玻璃筆記容器，不恢復 AI Dashboard 風格 |
| 搜尋與標籤 | 玻璃搜尋列、膠囊標籤，提供狀態變化而非華麗裝飾 |
| 文章閱讀 | 保留深色實體閱讀紙張，提高文字對比；將玻璃用在周邊控制介面 |
| 後台／編輯器 | 玻璃側欄與清楚的草稿／發布操作；正文保持不透明以便長時間編輯 |
| 動畫 | Premium easing、低幅度移動、約 180–700ms 的元件回饋與進場；尊重 reduced-motion |
| 裝置 | 320、375、768、1024、1440px 響應式；小螢幕提升表單字級、觸控範圍，並提供可鍵盤操作的毛玻璃導覽選單 |
| 退化處理 | 不支援 backdrop-filter 或要求 reduced-transparency 時，改為不透明表面 |

完整設計規則在 [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)。手機版不再隱藏「文章索引、學習足跡、關於」入口：點選右上角選單即可使用，支援 Enter／Esc、點擊導覽後收合及點擊選單外關閉。

## 公開文章 SEO 與閱讀無障礙

- **正式網域尚未確定時採安全預設**：未提供有效 HTTPS `NEXT_PUBLIC_SITE_URL` 時，不輸出指向 localhost 的 canonical、Sitemap 網址或 BlogPosting 結構化資料；robots 會拒絕爬取，避免錯把本機或預覽站當成正式網站。
- 日後使用者確認正式網域並部署時，才以明確設定的網域產生首頁／關於頁／文章 canonical、Open Graph／Twitter 分享中繼資料、已發布文章 Sitemap，以及只包含公開文章的 JSON-LD。
- 搜尋和標籤篩選結果不會建立重複可索引頁面；站長登入與管理工作室不會收錄。
- Markdown 正文的標題階層接在文章標題 H1 之後；站內連結保留原分頁，站外連結才開新分頁。寬表格可用鍵盤聚焦並水平捲動；35 天學習活動提供逐日螢幕閱讀器標籤。

SEO 仍須等待**正式 HTTPS 網域與真實文章**完成後驗收；設定合法網址只代表具備產生 metadata 的條件，不代表已部署或被搜尋引擎收錄。

## 不連接資料庫的開發測試

```powershell
npm ci --include=dev --no-audit --no-fund
npm run test:unit
npm run test:neon:rls
npm run typecheck
npm run build
```

單元測試使用 Node.js 24 內建測試工具，不連接任何 Supabase 或 Neon 線上資料庫、不產生帳號或外部費用。涵蓋不可信任的文章資料、草稿／發布限制、日期、UUID、異常搜尋網址，以及 Markdown 格式化。`tests/neon-rls.test.mjs` 另透過本機 PGlite 記憶體 PostgreSQL 模擬 Neon 官方的身分角色與 RLS，真實執行 `neon/migrations/001_initial_blog.sql` 的權限回歸測試；**SQL 在 Sandbox 已完成實測，並於 2026-10-15 獲新的明確授權套用到 Neon `production`，再次唯讀核對 RLS／GRANT；正式 E2E 尚未驗收**。GitHub Actions PR CI 會自動執行單元測試、TypeScript 和建置檢查。隔離 Neon 分支的真實 Auth／Data API 測試採**人工限定分支的手動腳本**，不自動執行、不新增真實帳號，也不將任何臨時密碼或 JWT 記錄進 GitHub。

若在 MSI（已安裝 Chrome／Edge）要進一步測試**真實 Next.js 網站與手機編輯器**，可執行：

```powershell
npm run test:browser:local
```

這個腳本使用 `playwright-core` 及本機瀏覽器，建立只綁定 **127.0.0.1** 的假 Supabase HTTP 服務與臨時 Next 開發伺服器，完成公開首頁、文章、假站長登入、手機 Markdown 工具、快速返回後的本機草稿恢復、假資料草稿→發布流程與動態介面檢查。所有帳號與文章都是**合成測試資料**，不會連接任何真實 Supabase 專案，也不會把模擬權限繞過寫進正式網站。截圖保存在 Windows 暫存目錄，不提交 GitHub。

為降低 GitHub Actions 時間與用量，瀏覽器腳本**僅在 MSI 本機手動執行**，不加入 PR CI。另有 `npm run verify:neon:sandbox:manual`，需先由操作者確認經 Neon Connector 核准的隔離分支與公開測試端點，並對合成站長 ID 進行受控授權／驗後清理；**絕不可接到 CI 或對 `production` 執行**。隔離 Neon Auth／JWT／RLS／CRUD 已經實測成功，完整去敏證據見 [Neon 測試報告](docs/NEON_INTEGRATION_READINESS.md)。目前可選擇 Neon Sandbox 後端實際執行網站路由，但不代表 Neon production、真實站長或正式部署已完成。

### Neon Sandbox 真實網站驗收（完全不碰 production）

使用者已授權在獨立 Neon Free 的 `naosledge-integration-sandbox-20261015` 分支驗證全網站。現有 PR 新增「**後端模式切換**」：預設 `NAOSLEDGE_BACKEND=supabase`，明確設定下列**伺服器和前端一致**的旗標後，才走 Neon：

```env
NAOSLEDGE_BACKEND=neon
NEXT_PUBLIC_NAOSLEDGE_BACKEND=neon
NAOSLEDGE_NEON_BRANCH_ID=br-quiet-sunset-b4xx4pnx
NEON_AUTH_BASE_URL=https://YOUR_APPROVED_SANDBOX.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth
NEON_DATA_API_URL=https://YOUR_APPROVED_SANDBOX.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1
NEON_AUTH_COOKIE_SECRET=YOUR_PRIVATE_RANDOM_32PLUS_CHARACTER_SECRET
```

上面網址是**格式範例**，不是正式連線設定。測試腳本會使用已核准的公開 Sandbox endpoint，在每次啟動本機 Next.js 時**於記憶體產生新的 Cookie Secret**，不存入檔案、GitHub 或 CI。Neon Sandbox 的後端設定硬性核對允許的 branch ID 及 endpoint，**任何 production 或其他分支會被拒絕**。

MSI 手動測試：以合成 Better Auth 身分登入，執行非站長拒絕、站長工作室、儲存草稿、匿名 404、發布後匿名 200、編輯、刪除後 404、登出。Neon Data API 只會看到其官方簽發的 Bearer JWT，**不以解碼的未驗簽 claims 或客戶端 Email 作為站長授權**。使用 `npm run verify:neon:sandbox:manual` 並設 `NAOSLEDGE_NEON_WEBSITE_BROWSER=1` 可附加真實網站 Chrome E2E，但**需要受控 Neon Connector 暫時授予合成站長 ID**，驗後務必清理；不得交給 GitHub Actions 自動執行。

2026-10-15 實際跑完後，已再次查核測試分支 `posts=0`、`blog_admins=0`、合成 Auth users=0。當次 Sandbox 測試時正式 `production` 尚無文章表；後續已經另行授權建表，網站仍未部署。完整驗收與後續決策見 [Neon 實測紀錄](docs/NEON_INTEGRATION_READINESS.md)。

### 長文章閱讀導覽

- 章節目錄直接從 Markdown AST 解析，支援中文／英文、重複小標、粗體與程式碼行內格式；程式碼區塊中的 `#` 不會被誤判為標題。
- 目錄連結直接指向文章中的同名標題，桌面是細緻的側欄目錄；手機改為最小觸控高度 44px 的橫向章節列，避免遮蔽正文。
- 頁面頂端有低調、只用 GPU transform 更新的閱讀進度條；原本的 reduced-motion 設定保留。文章尾端可回到開頭。
- 程式碼區塊提供一鍵「複製」按鈕，成功或失敗會呈現明確狀態，不需要另外安裝套件或連線 API。
- MSI 實際 Chrome 以合成長文驗證目錄錨點、中文重複章節、手機版、閱讀進度、程式碼複製及返回文章開頭。此驗證仍不涉及 Supabase。

### 寫作體驗

Markdown 編輯器提供標題、粗體、斜體、清單、連結、**圖片**與程式碼的玻璃工具列，可直接在手機點擊；桌機另支援 `Ctrl/⌘+B`（粗體）及 `Ctrl/⌘+K`（連結）。本機草稿會在輸入後暫存，失去焦點或快速返回工作室時也會立即嘗試儲存；**本機暫存不等於雲端同步**。已公開文章若改回草稿，按鈕顯示「下架為草稿」並再次確認，避免誤以為只是儲存修改。

### 本機 Markdown 備份（不用正式資料庫）

寫作編輯器新增「**下載 .md 備份**」與「**匯入 .md**」功能，所有檔案操作都在目前瀏覽器內完成，**不會上傳到任何服務**：

- 下載內容是可閱讀的 Markdown 檔，開頭含少量 Naosledge 標題、slug、摘要、分類、標籤與學習日期資訊，正文維持原本 Markdown 格式。檔名會使用安全的文章 slug。
- 再匯入這份檔案時，可還原文章資訊與正文；一般 `.md`（沒有 Naosledge 標記）則只匯入正文，保留目前標題與文章設定。
- 匯入前會要求確認是否覆寫編輯器內容，按取消就會保留原稿；限制檔案最大 1 MB、正文最多 200,000 字元。
- **匯入只會變更本機編輯器狀態與本機暫存，永遠不會自動發布**。需要同步網站，仍必須按「儲存草稿」或「發布文章」；在已驗證的 Neon Sandbox 模式下可使用真正的草稿與發布功能；正式網站尚未上線，請勿把測試資料當成正式內容。
- 本機瀏覽器的 `localStorage` 可能被瀏覽器清除，因此長文建議定期下載 `.md` 備份，並自行保存在安全的資料夾。匯出檔案可能含個人未公開文字，請不要直接放到公開 GitHub Repository。

MSI Chrome 已使用合成筆記驗證實際檔案下載、匯入確認／取消、資訊恢復，以及整個流程沒有寫入假資料庫。

### 圖片使用方式（不需要 Supabase Storage）

- 透過編輯器「圖片」工具，先選取圖片的描述文字（例如「系統架構流程圖」），點擊後會產生 `![系統架構流程圖](https://example.com/image.jpg)`，並自動選取網址供貼上替換。
- 支援 **HTTPS 圖片網址**，或手動加入 `public/images` 目錄後以 `/images/圖片名稱.png` 引用的站內靜態檔案；**目前沒有拖曳上傳、圖片儲存空間或自動圖床**。
- 可在 Markdown 圖片網址後加上雙引號圖說：`![圖片替代文字](https://images.example.org/diagram.png "流程示意")`。圖片會依容器寬度等比縮放、保留完整比例；採 `loading="lazy"`、`decoding="async"` 和 `referrerPolicy="no-referrer"`。
- 為避免混合內容與不安全圖片請求，拒絕 HTTP、`data:`、`javascript:`、本地網路 IP、內含憑證及協定相對網址。被拒絕的圖片會顯示清楚提示，而不是靜默載入。
- 請為資訊性圖片寫**有意義的替代文字**。外部 HTTPS 圖片伺服器即使不會收到本文網址，**仍可能知道讀者 IP**；若要避免第三方請求，請使用站內靜態圖片。

本機 Chrome 的 HTTPS 圖片由 **Playwright 記憶體攔截與合成 SVG** 提供，不會造訪任何範例圖片網域，測試結果不代表第三方圖床的真實可用性。

## 網站路由

| 路由 | 說明 |
|---|---|
| `/` | 公開首頁、搜尋、篩選、筆記索引 |
| `/#timeline` | 近 35 天學習日曆與最近學習紀錄 |
| `/notes/[slug]` | 已發布文章；草稿不可公開閱讀 |
| `/about` | 關於 Naosledge |
| `/login` | 站長登入（無公開註冊） |
| `/forgot-password`、`/reset-password` | Neon Sandbox 專用密碼啟用／重設流程；非 Neon 模式 404，未對外部署 |
| `/studio` | 受保護的文章管理工作室 |
| `/studio/new`、`/studio/[id]` | 新增／編輯草稿或公開文章 |
| `/sitemap.xml` | 已發布文章 Sitemap |

## 本機開發與驗證（尚未正式上線）

目前網站程式位於 **Draft PR #1 的開發分支**；`main` 尚未合併。已選定 Neon Free 作為後續專屬資料庫，但**現有 Neon 網站模式只允許經授權的 Sandbox**，不能將正式 Neon 連線資訊直接填入後上線。開發環境使用 Node.js 24（CI 同版）、npm，絕不借用 Mushroooooms、Go Travel 等既有 Supabase 專案。

以下流程不需要資料庫帳號或密鑰，也不會連線正式 Neon：

```powershell
git clone https://github.com/Naos2w/Naosledge.git
Set-Location .\Naosledge
git switch --track origin/feat/initial-v3-site-20261015
npm ci --include=dev --no-audit --no-fund
npm run test:unit
npm run typecheck
npm run build
npm run test:browser:local
npm run test:browser:neon-recovery:local
```

`test:browser:local` 以 MSI 上已安裝的 Chrome／Edge、127.0.0.1 的假 Supabase 執行合成瀏覽器測試；不需真實登入。若僅啟動 `npm run dev`，預設 Supabase 模式在沒有**Naosledge 專屬**資料庫設定時，實際文章載入／登入不會正常運作，不能誤認為已部署。

### 已完成的 Neon Sandbox 模式

**2026-10-16 新增帳號啟用準備：** 登入頁增加「忘記密碼／首次設定密碼」入口，經由 Neon Better Auth 的 `requestPasswordReset`／`resetPassword` API 處理，伺服器端回呼只允許明確的 `localhost`，或限定 Vercel 專案 ID／Preview 開發分支／HTTPS 分支網域的 Sandbox 預覽網址。MSI Chrome 已驗證頁面、無效 Token、輸入安全規則，以及 Token 從網址移除；**沒有真正寄信或在 Production 重設密碼**。正式 Auth 已建立一個待啟用帳號（Email 未驗證、尚未有密碼與 `blog_admins` 權限）；仍需先完成安全 HTTPS 網域、Auth 設定與本人驗證，才能開始正式站長登入。

在明確設定後端旗標、核准的 Sandbox branch ID、相應 Auth／Data API HTTPS URL 及**私有** Cookie Secret 後，現有 Next.js 網站已可使用真正 Neon Auth／JWT 與 RLS。僅可在核准的 Sandbox 模式用受控、合成帳號驗證，**不可設為 Neon Production**；細節見 [隔離整合報告](docs/NEON_INTEGRATION_READINESS.md)。

### 舊 Supabase 路徑（僅作相容回退）

`supabase/schema.sql` 與 Supabase SDK 保留為歷史相容路徑，**不是目前選定的正式資料庫**。不要新建 Supabase 專案、把 SQL 套用到其他專案，或使用任何既有服務的 URL／金鑰。Neon 使用不同的 Better Auth `text` 使用者 ID 和獨立的 `neon/migrations/001_initial_blog.sql`；已經在 Sandbox 套用及驗收，且另獲授權於 2026-10-15 套用至 Production；正式站長與網站仍未啟用。

## Vercel Preview：Git 開發分支已建置，待線上功能驗收

**2026-10-17 新進度：** Owner 已自行在 Hobby 團隊建立 Vercel `naosledge`（Next.js 24.x）；GitHub PR #1 的 feature 分支已自動產生 **READY Preview**，正式 `main` 的初始部署則是 ERROR，兩者不互相代替。已確認 Preview 的 [固定 HTTPS 分支網址](https://naosledge-git-feat-initial-v3-site-20261015-naos-tsais-projects.vercel.app)、Vercel Authentication 保護，並設定 7 項只限該分支的 Neon Sandbox 環境變數（含加密 Cookie Secret），Production 環境變數為 0。**仍需以後續新 Preview 建置驗證網站 Runtime／密碼恢復流程；尚未實際寄信、授予正式站長或部署 Production**。詳細見 [Vercel Sandbox Preview 清單](docs/VERCEL_SANDBOX_PREVIEW.md)。

**正式 Production 網站**仍未獲授權；不能只因 `next build` 成功就公開網站。正式上線前仍須另外核准：

1. **Neon Production Migration／Data API 已完成**；正式 Auth 註冊與信箱驗證政策，以及真正站長身分仍待 Owner 確認。
2. 專用的 Production 後端設定模式（現有程式**硬性拒絕 Production**）、經審查的 RLS／登入／Cookie Secret。
3. 正式 HTTPS 網域與部署設定；Preview 專案和分支已建立、Sandbox 變數已設定，但需完成實際線上驗收。PR 合併與正式 Production 發布仍需後續核准。

詳細的五道安全關卡、SEO 安全預設、功能測試矩陣與回復計畫請見 [**上線前置與驗收清單**](docs/DEPLOY_READINESS.md)。**切勿照舊版 Supabase 部署教學操作**。

## 驗證範圍與限制

- 320、375、768、1024、1440px 的 MSI 本機 Chrome／合成瀏覽器測試涵蓋導覽、Markdown、搜尋、草稿、無障礙與 SEO 安全預設；尚未以 iPhone Safari 做實機驗收。
- 2026-10-16 在 MSI 重新執行完整單元測試（含 PGlite RLS 與新增密碼重設安全規則）、TypeScript 與正式建置，均成功；目前 CI 仍只做離線測試，不會連接 Neon。
- **真實 Neon Sandbox** 已在受控環境完成 Better Auth／JWT／Data API／RLS、登入與網站文章 CRUD，合成測試文章、授權及帳號已清理；**不能當作 Neon Production 的安全驗收**。
- Neon `production` 已完成應用 SQL、6 項 RLS Policy 與 Data API 啟用；一個正式 Auth 帳號已建立但尚未驗證 Email／設定密碼／授予站長權限，Production 網站模式、網域與 Vercel 部署均未完成。
- 目前未加入 AI、公開留言、圖片上傳、完整文章歷史版本或讀者公開註冊。
- 編輯器本機草稿儲存不是雲端同步；在已驗證的 Sandbox 模式仍須明確點選「儲存草稿／發布文章」，才會送出真正的資料庫操作。
- 首頁搜尋最多比對 300 篇已發布文章；資料量增長後，需另評估後端全文搜尋效能。

如需細部驗證證據，請見 [`QA.md`](QA.md) 和 [Neon 實測報告](docs/NEON_INTEGRATION_READINESS.md)。


## 專案命名與開發位置

- 正式品牌：**Naosledge**
- MSI 本機開發目錄：`C:\Naos\02.Git\personal\Naosledge`
- GitHub 倉庫：[`Naos2w/Naosledge`](https://github.com/Naos2w/Naosledge)
- npm package name：`naosledge`
- 舊名稱 LearnLog 與 Naosledge v2 僅留作歷史備份；本專案不需要因此修改資料庫 schema 或文章欄位。
- 原始碼在 GitHub 以 Draft PR #1 送審；Neon Sandbox 驗收已通過，**Vercel Preview 已建置但仍待線上 Runtime 驗證；Neon Production DB/API 已完成授權範圍內的建置，正式 Production 網站尚未上線**。
