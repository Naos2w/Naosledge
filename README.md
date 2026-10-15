# Naosledge v3 · Minimal Dark Liquid Glass

一個使用 **Next.js + Supabase** 的繁體中文公開學習部落格，採用現代極簡、預設深色的 Liquid Glass 介面，同時維持以閱讀與寫作為中心的資訊架構。文章對訪客公開，**只有站長可以登入、編輯、發布或刪除內容**。AI 摘要留待第二階段。

> v3 在先前版本的基礎上加入 Dark Liquid Glass 與流暢動畫，保留文章資料結構、Supabase RLS、登入及資料存取邏輯。v1、v2 保留為歷史版本。

## 專案狀態

GitHub 原始碼為可部署的 Next.js 網站，不包含離線 UI 展示用的虛構文章與不需登入的模擬後台。離線互動預覽另存於 ChatGPT 專案成果中，不是正式網站，也不會把筆記寫入 Supabase。

目前已於 MSI 執行 `npm run typecheck` 與 `npm run build` 成功；尚待建立 Naosledge 專用 Supabase 專案、驗證真實登入與文章寫入，以及部署 Vercel。上線前必須完成的權限與費用檢查，詳見 [`docs/DEPLOY_READINESS.md`](docs/DEPLOY_READINESS.md)。

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
| 裝置 | 375、768、1024、1440px 響應式；小螢幕提升表單字級和按鈕觸控範圍 |
| 退化處理 | 不支援 backdrop-filter 或要求 reduced-transparency 時，改為不透明表面 |

完整設計規則在 [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)。

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
