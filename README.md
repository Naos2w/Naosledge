# Naosledge v3 · Minimal Dark Liquid Glass

一個使用 **Next.js + Supabase** 的繁體中文公開學習部落格，採用現代極簡、預設深色的 Liquid Glass 介面，同時維持以閱讀與寫作為中心的資訊架構。文章對訪客公開，**只有站長可以登入、編輯、發布或刪除內容**。AI 摘要留待第二階段。

> v3 在先前版本的基礎上加入 Dark Liquid Glass 與流暢動畫，保留文章資料結構、Supabase RLS、登入及資料存取邏輯。v1、v2 保留為歷史版本。

## 專案狀態

GitHub 原始碼為可部署的 Next.js 網站，不包含離線 UI 展示用的虛構文章與不需登入的模擬後台。離線互動預覽另存於 ChatGPT 專案成果中，不是正式網站，也不會把筆記寫入 Supabase。

目前已於 MSI 執行 `npm run test:unit`、`npm run typecheck` 與 `npm run build`；尚待專用 Supabase、真實權限驗收與 Vercel 部署。**2026-10-15 Supabase 免費專案名額已滿，使用者選擇維持免費且不影響現有服務**，因此不得建立／共用現有資料庫或擅自升級方案。詳細決策與上線檢查見 [`docs/DEPLOY_READINESS.md`](docs/DEPLOY_READINESS.md)。

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
npm run typecheck
npm run build
```

單元測試使用 Node.js 24 內建測試工具，不連接任何 Supabase 專案、不產生帳號或外部費用。涵蓋不可信任的文章資料、草稿／發布限制、日期、UUID、異常搜尋網址，以及 Markdown 格式化。GitHub Actions PR CI 會自動執行單元測試、TypeScript 和建置檢查。

若在 MSI（已安裝 Chrome／Edge）要進一步測試**真實 Next.js 網站與手機編輯器**，可執行：

```powershell
npm run test:browser:local
```

這個腳本使用 `playwright-core` 及本機瀏覽器，建立只綁定 **127.0.0.1** 的假 Supabase HTTP 服務與臨時 Next 開發伺服器，完成公開首頁、文章、假站長登入、手機 Markdown 工具、快速返回後的本機草稿恢復、假資料草稿→發布流程與動態介面檢查。所有帳號與文章都是**合成測試資料**，不會連接任何真實 Supabase 專案，也不會把模擬權限繞過寫進正式網站。截圖保存在 Windows 暫存目錄，不提交 GitHub。

為降低 GitHub Actions 時間與用量，瀏覽器腳本**僅在 MSI 本機手動執行**，不加入 PR CI。**假資料 RLS、假登入測試通過，不代表正式 Supabase Auth 或 RLS 已通過；正式資料庫仍未建立。**

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
- **匯入只會變更本機編輯器狀態與本機暫存，永遠不會自動發布**。需要同步網站，仍必須按「儲存草稿」或「發布文章」；在還沒有 Supabase 專用資料庫時，這兩個雲端操作仍不能使用。
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
| `/studio` | 受保護的文章管理工作室 |
| `/studio/new`、`/studio/[id]` | 新增／編輯草稿或公開文章 |
| `/sitemap.xml` | 已發布文章 Sitemap |

## 本機啟動正式網站

需求：Node.js 22+、npm、**Naosledge 專用 Supabase 專案**。請勿將本專案 SQL 執行到其他既有產品資料庫。

```bash
git clone https://github.com/Naos2w/Naosledge.git
cd Naosledge
npm ci --include=dev
cp .env.example .env.local
# 在 .env.local 填入 Naosledge 專用 Supabase URL、publishable key
npm run dev
```

Windows PowerShell：

```powershell
git clone https://github.com/Naos2w/Naosledge.git
Set-Location .\Naosledge
npm ci --include=dev
Copy-Item .env.example .env.local
notepad .env.local
npm run dev
```

之後開啟 http://localhost:3000。 `package-lock.json` 已納入 Git，CI 使用 `npm ci --include=dev` 重現安裝。注意：某些電腦全域設定 `NODE_ENV=production`，因此明確加上 `--include=dev`，不需要調整全域環境變數。網站沒有 Supabase 設定時，**首頁與正式文章讀寫無法正常運作**，但程式可以進行型別檢查與建置。

### 首次設定 Supabase

1. 在 Supabase 建立 **Naosledge 專用**專案。
2. 進入 **Authentication → Users**，建立站長 Email / Password，記下使用者 UUID。關閉公開註冊（Disable sign ups）。
3. 在專用專案的 SQL Editor 執行 `supabase/schema.sql`，建立文章表、站長表與 Row Level Security 政策。
4. 以站長的真實 UUID 執行：

   ```sql
   insert into public.blog_admins(user_id) values ('YOUR-ADMIN-UUID');
   ```

5. 在 `.env.local` 設定 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 與 `NEXT_PUBLIC_SITE_URL`。請**不要**把 `service_role`、secret key 或其他私密憑證放在公開環境變數或 Git。
6. 開啟 `/login` 登入站長，前往 `/studio` 新增文章，先測試草稿不可被未登入訪客查看，再測試發布文章。

v3 未修改任何 Supabase schema 或 RLS；若已有 v1 專用資料庫，保留其原始表與資料即可，不要重複建立或覆蓋。

## 部署到 Vercel

1. 將 `Naosledge` 原始碼推送到 GitHub（**不含 `.env.local`**）。
2. 在 Vercel 匯入倉庫，Framework 選 Next.js。
3. 設定與本機對應的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、正式 `NEXT_PUBLIC_SITE_URL`。
4. 部署後驗證公開文章、`/studio` 權限轉址、草稿 404 與新增／編輯／刪除流程。

## 驗證範圍與限制

- 已完成預覽端 375、768、1024、1440px 畫面與互動測試；首頁、關於、文章、工作室、編輯器都無水平溢出。
- 已驗證搜尋、Markdown 預覽、新增／發布示範筆記、深淺色切換與偏好保存、Reduced Motion，以及瀏覽器中操作的錯誤訊息。
- 2026-10-15 於 MSI 安裝依賴後，`npm run typecheck` 與 `npm run build` 均通過；這是編譯驗證，不代表真實 Supabase 連線已驗收。
- 尚未建立正式 Supabase 專案，沒有雲端寫入或真實權限驗收，也沒有部署網站。
- 此階段未加入 AI、公開留言、圖片上傳、完整歷史版本或公開註冊。
- 本機編輯器暫存不是雲端儲存；**一定要點選儲存草稿／發布文章**才會同步至 Supabase。
- 搜尋仍對最近最多 300 篇公開文章進行比對，若筆記大幅增加，可再升級後端全文搜尋。

如需細部測試證據，請見 [`QA.md`](QA.md)。


## 專案命名與開發位置

- 正式品牌：**Naosledge**
- MSI 本機開發目錄：`C:\Naos\02.Git\personal\Naosledge`
- GitHub 倉庫：[`Naos2w/Naosledge`](https://github.com/Naos2w/Naosledge)
- npm package name：`naosledge`
- 舊名稱 LearnLog 與 Naosledge v2 僅留作歷史備份；本專案不需要因此修改資料庫 schema 或文章欄位。
- 原始碼在 GitHub 以 PR 送審；**尚未完成 Supabase 線上驗收與 Vercel 正式部署**。
