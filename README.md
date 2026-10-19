# Naosledge v3 · Minimal Dark Liquid Glass

一個以 **Next.js** 開發的繁體中文公開學習部落格，採用現代極簡、預設深色的 Liquid Glass 介面，同時維持以閱讀與寫作為中心的資訊架構。文章對訪客公開，**只有站長可以登入、編輯、發布或刪除內容**。目前正式網站使用 **Neon Free Production（Better Auth + Data API + PostgreSQL RLS）**；本機程式仍保留 Supabase 相容回退路徑，但正式環境需通過精確 SHA 與資料庫設定的發布閘門。P4 AI 語意搜尋／問答及 Obsidian **自動雙向同步**尚未實作；私人編輯器已新增可手動使用的 Obsidian 格式匯出／匯入互通。

> v3 在先前版本的基礎上加入 Dark Liquid Glass 與流暢動畫，保留文章資料結構、Supabase RLS、登入及資料存取邏輯。v1、v2 保留為歷史版本。

## 正式環境狀態（2026-10-18）

- **網站已正式上線**：[Naosledge](https://naosledge.vercel.app)（2026-10-18 已核准改用短網址作為 canonical；原長網址設定永久轉址）。[PR #1～#15](https://github.com/Naos2w/Naosledge/pulls?q=is%3Apr+is%3Amerged) 均已合併至 `main`，已核准的 Production 版本 `a5f3428c8a5d9d81d7f32b5fdd50399d6faf6f3b` 已部署，包含私人詞彙搜尋與 Obsidian 手動 Markdown 互通。之後更新仍需按 SHA gate 手動發布。未登入可讀公開頁，私人路由須登入。
- **站長已驗收**：Owner 親自確認正式站長登入及 `/studio`、`/vault` 可以存取；Private Vault 與 Knowledge Atlas 具備獨立 Neon JWT/RLS 權限限制。獨立 Private Vault Preview 驗收完成後已停用。
- **資料保護**：正式 Neon 原有站長授權已建立、公開註冊與 localhost 關閉；三張 Private Vault 資料表有 10 項 RLS 政策。最終確認時沒有測試筆記或公開文章；日後實際資料量以線上資料庫為準。
- **正式發布閘門**：需要匹配核准的 `main` SHA、Vercel Production project/branch、HTTPS origin 與 Neon Production 配對。因合併後的新 SHA 無法提前推測，Vercel `main` Git 自動部署已設為停用；請先通過 GitHub CI、合併，再核對及更新正式環境的 SHA／網址，以**手動 Production 部署**生效。切勿關閉安全閘門解決 503。Vercel Standard Protection 保護 Preview，而公開正式網域可供訪客使用。
- **後續工作**：私人搜尋已具備零 API 費用的詞彙相關度排序（[設計與限制](docs/PRIVATE_SEARCH_RELEVANCE.md)），不等於 P4 AI 語意搜尋。[Obsidian 單篇 Markdown 手動互通](docs/OBSIDIAN_MARKDOWN_BRIDGE.md) 已上線；並已將 [雙向同步的離線衝突／刪除安全預演](docs/OBSIDIAN_SYNC_SAFETY.md) 合併到 `main`，並已合併 [可手動逐篇確認的合成同步沙盒](docs/OBSIDIAN_SANDBOX_SYNC.md)；目前另建置 [Neon Sandbox 限縮式唯讀介面與匿名權限驗證](docs/OBSIDIAN_NEON_SANDBOX_READONLY.md)。**尚未**接上 Neon Auth 的同步執行器，不會自動讀寫真正的私人 Vault 或 Production。另外新增 [正式網站唯讀健康檢查](docs/LIVE_HEALTH_OPERATIONS.md)，僅由人工觸發 GitHub Actions，不會無故消耗每日額度。文章發布／下架仍待 Owner 真人驗收；P4 AI 問答、Obsidian 自動同步需另行決定隱私與費用界線。見 [正式發布閘門](docs/PRODUCTION_RELEASE_GATE.md)。

## MSI Obsidian 安裝準備與 TypeScript 規則

- **Obsidian 同步電腦**已指定為 Windows 11 **MSI**，Obsidian 1.14.4 已安裝；Owner 核准的 `C:\Naos\Obsidian\Naosledge` 已建立、仍為空白。Obsidian GUI 已完成首次註冊並由 MSI 唯讀驗證。新增 TypeScript 唯讀工具 `npm run verify:obsidian:vault:msi`，只檢查該路徑的直接 `.md` 指紋，不外連、不新增／刪除私人資料。詳見 [MSI Vault 設定](docs/OBSIDIAN_MSI_SETUP.md) 與 [同步安全預演](docs/OBSIDIAN_SYNC_SAFETY.md)。
- **TypeScript-first**：正式網站與共用邏輯一律優先 TS／TSX；原有 `.mjs` 多為 Node 原生測試／維護腳本，後續只在能保留 CI／舊 Node 相容性時分批遷移。詳見 [語言／測試工程規範](docs/TYPESCRIPT_GUIDELINES.md)。

## 專案狀態

GitHub 原始碼為可部署的 Next.js 網站，不包含離線 UI 展示用的虛構文章與不需登入的模擬後台。離線互動預覽另存於 ChatGPT 專案成果中，不是正式網站，也不會把筆記寫入 Supabase。

目前正式版本已有 Next.js 公開部落格、Neon Auth 站長工作室、私人知識庫與 P3 Knowledge Atlas，並完成 Owner 登入驗收。仍使用 Neon Free／Vercel Hobby，不得在未經核准下升級付費或操作其他專案。CI 使用 Node.js 24，執行離線單元測試、TypeScript、正式建置與關閉版安全檢查；本機另有離線 Chrome 回歸。下方 P1–P3 與資料庫啟用段落保留當時的**開發歷史與安全驗收紀錄**，如與本節日期不同，以本節的已確認狀態為準。

## P1 + P2：私人第二大腦（已完成，以下為歷史開發紀錄）

Naosledge 已擴展為 **Private-first 第二大腦**。本節記錄最初在獨立分支 `feat/private-knowledge-vault-20261017` 的開發與驗收（現已整合到 `main`）。新建 `/vault`、`/vault/new`、`/vault/[id]`，以獨立 `knowledge_notes` 保存私人 Markdown，並支援搜尋索引、`[[slug]]`、`[[標題|顯示名稱]]`、雙向反向連結與尚未解析的關係。

- **私人預設**：新表使用 Neon Auth JWT + RLS，只有實際站長能讀取**自己**的私人筆記，匿名和一般登入者無表格／RPC 權限，與公開 `posts` 完全分離。
- **經審核的公開副本**：可明確產生一篇與私人原稿分離的 **status=draft** 文章，需再進入既有 Studio 檢查、手動發布；私人關係與來源 mapping 不會公開。
- **效能與限制**：已有 PostgreSQL `tsvector/GIN` 英文全文搜尋；中文以 Unicode 字串比對作為初期功能（尚非索引化中文搜尋）。P3 互動式知識圖譜已在獨立 Draft 開發分支實作，AI 語意搜尋與 Obsidian 雙向自動同步仍待後續階段。
- **部署邊界**：Owner 已明確核准且在 **Naosledge Neon Sandbox** 套用 `002_private_knowledge_vault.sql`；SQL 與真實 Neon Auth／JWT／RLS／Chrome E2E 都已通過，測試資料清理為 0。**Production 已在 2026-10-17 取得核准並成功套用 002，三張 Private Vault 表及 RLS 已唯讀核對**。分支 `vercel.json` 仍禁止新分支自動 Preview 部署，避免影響 PR #1 的 Vercel 或耗用未核准額度。
- **測試**：本機 PGlite 權限、SQL RPC、中文搜尋、Wikilinks、公開草稿副本、單元測試、Next.js Build 和舊網站 Chrome 回歸均通過，另外已完成**真實 MSI Chrome + Neon Sandbox** 私人筆記新增、雙向連結、Backlinks、中文搜尋、跨帳號隔離與公開草稿保護驗收。

詳見 [Second Brain 架構規格](docs/SECOND_BRAIN_ARCHITECTURE.md) 與 [Neon Sandbox 實體驗收及清理證據](docs/SECOND_BRAIN_SANDBOX_VERIFICATION.md)。**Sandbox 已完成真實 E2E 驗收，Production 002 Schema 已套用並後驗確認**；正式帳號亦已由本人完成 Email 驗證與首次密碼設定、Production Allow Localhost 已關閉。**正式站長已另行獲核准並新增 1 筆 `blog_admins`**；實際 Production 網頁登入驗收、PR 合併與正式發布仍需另行授權。

## P3 — Knowledge Atlas 私人知識網絡（已完成，歷史開發紀錄）

在獨立分支 `feat/knowledge-graph-p3-20261017` 新增 **`/vault/graph`**，只對通過正式 Neon Auth／Email 驗證／RLS 站長權限的本人開放，沿用 Naosledge 現有深色閱讀風格。

- **知識節點與關係**：`[[slug]]`、`[[標題|別名]]` 解析雙向可檢索的引用關係；選取節點可觀察最多兩層鄰居，從私人編輯器直接進入該節點圖譜。
- **互動與閱讀**：依分類排佈的穩定 SVG 星座視覺、節點點擊與鍵盤操作、搜尋與分類篩選、縮放／手機局部平移；另外提供完整可存取的筆記清單作為替代導覽。
- **安全與免費額度**：只讀取 Owner 本人的標題、分類、標籤和關聯鍵，不傳遞 Markdown 私人正文或來源映射；最多查最近 180 篇與 2,400 條連結，圖上最多 100 個節點，保留清楚的截斷提示。不建立新的資料庫、AI API 或持續動畫，`/vault` 私人頁皆使用 `no-store`、`no-referrer`、`noindex`。
- **測試**：P3 純演算法測試、375／768／1024／1440px Chrome 畫面、焦點與滑動、SVG/清單鍵盤導航、雙向關係，以及 Supabase 舊模式 Vault 一律 404。Chrome 使用 MSI 本機合成資料、沒有接觸 Neon 正式筆記。
- **部署界線**：新分支在 `vercel.json` 禁止自動部署以節省 Vercel／GitHub 額度，P3 尚未合併，也沒有對 Production 網站發布或修改正式 Auth／Schema。P4 語意搜尋及 AI 知識問答仍須後續設計。

詳細規格與測試見 [P3 Knowledge Atlas](docs/KNOWLEDGE_GRAPH_P3.md)。

## Production 私人知識庫 Migration 與站長啟用（2026-10-17 歷史紀錄）

**2026-10-17：Production `002` Migration 已完成。** 只在 Neon `Naosledge` 的 `production` 分支使用單一交易套用 42 項 SQL，後驗確認三張私人知識表、10 項 RLS 政策、JWT 身分函式、搜尋和 Backlinks 索引；`posts`、`blog_admins` 與正式 Auth 帳號都保留。新表資料為 0，原有文章及站長授權在遷移當下仍為 0；後續另經明確核准，現有 1 筆站長授權。**不得重複執行 Migration。**

**2026-10-17 正式帳號啟用驗證已完成。** Neon Production 已唯讀核對原有帳號 `emailVerified=true`、Credential 密碼已建立 1 筆、`Allow Localhost=false`、Email 公開註冊關閉；**後續另經使用者核准，已新增精確且唯一的 `blog_admins` 站長授權**。獨立受保護 Vercel HTTPS Preview 已被本人用來完成驗證，之後已將啟用旗標設為 `0`，並重新部署 Preview（READY）讓停用設定生效；Neon Production Auth 也已撤銷暫時的 Trusted Domain。原 PR #1 Preview 仍只連 Sandbox，新站點沒有接通 Production Data API。Neon Console 沒有強制驗證 Email 的獨立開關，因此程式本身新增站長 Email 驗證檢查。正式站長授權已完成，且 Owner 已在 SSO 保護的 Private Vault Preview 完成真人登入及私人 CRUD 驗收；正式 Production 網站整合部署與公開閱讀仍須另外核准。見 [Owner Activation 安全準備與關閉紀錄](docs/OWNER_ACTIVATION_READINESS.md)。

**Production 資料表可用 ≠ 正式網站已發布。** 本階段沒有合併 PR、改動 Vercel Production，也沒有直接對正式資料庫做真人私人筆記 CRUD。

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
