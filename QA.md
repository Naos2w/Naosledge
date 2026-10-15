# Naosledge v3 — UI / QA 驗證

驗證日期：2026-10-14

## 已完成（實際執行）

- 使用 Playwright Chromium `page.set_content` 載入與 `app/globals.css` + `app/glass.css` 一致的完整單檔預覽；瀏覽器執行環境禁止瀏覽 `localhost`、`data:` 和 `file:` URL，因此改用記憶體 localStorage shim 驗證互動，**並非實際使用者電腦 Chrome 驗收**。
- 檢查 1440、1024、768、375px 首頁均預設 `data-theme=dark`，`scrollWidth <= viewport width`；nav 實際計算結果為 `blur(24px) saturate(1.55)`。
- 375px 編輯器沒有水平溢出；擷取首頁、編輯器、文章、工作室的實際 Chromium 截圖。
- 深色 → 淺色切換並在預覽重載後保持淺色 → 返回深色，記憶體 localStorage 選擇正常。
- 關鍵字搜尋 `Rebase`，返回相符筆記；進入 Studio、新增示範筆記、Markdown H2 預覽與發布，列表從 5 篇增至 6 篇；文章閱讀頁可開啟。
- `prefers-reduced-motion: reduce` 時，頁面進場動畫計算為 `animation-name: none`。
- 單檔預覽 JavaScript `node --check` 無語法錯誤；TS/TSX 使用 TypeScript `createSourceFile` 解析（28 個非宣告檔案、0 個語法錯誤）。
- 正式文章 CRUD、Auth 客戶端、資料表 schema、RLS 未修改；改動是樣式、主題切換與離線預覽的設計呈現。

## 2026-10-15：MSI 真實原始碼整合驗收

- 原始碼已匯入 `C:\Naos\02.Git\personal\Naosledge`，工作分支為 `feat/initial-v3-site-20261015`。
- Windows MSI：Node.js `v24.21.0`、npm `11.19.0`；`npm install --include=dev` 成功並產生 `package-lock.json`。
- `npm run typecheck`：**exit 0**；`npm run build`：**exit 0**，Next.js 16.4.0 編譯、型別與路由最佳化皆成功。
- MSI 全域 `NODE_ENV=production` 會使 npm 預設略過 devDependencies，因此安裝與 CI 指令明確使用 `--include=dev`，不修改全域設定。
- 加入精簡 GitHub Actions CI：PR 與 main push 時執行 `npm ci`、型別檢查、正式建置；PR #1 首次 GitHub CI Run `38669132891` 已成功通過。

## 2026-10-15：部署前權限修正與防呆

- 非站長帳號登入後會檢查 `blog_admins` 自身授權紀錄；不具授權時立即登出並顯示清楚錯誤，避免登入循環。**此流程尚待真實 Supabase 帳號端到端測試**。
- 增加匿名訪客資料讀取的只讀檢查 `npm run verify:anonymous`，可搭配指定測試草稿驗證不可公開；需有專用 Supabase 專案後才能實際執行。
- 完整上線與費用／組織決策檢查見 `docs/DEPLOY_READINESS.md`。
- MSI 已重新執行 `node --check`、`npm run typecheck` 與 `npm run build`，均成功，無需變更其他專案。

## 2026-10-15：免費／無資料庫離線回歸測試

- 使用者指定 **維持免費，不暫停或更動 Mushroooooms、Go Travel 或其他 Supabase 專案**；Supabase 免費專案數已滿且新建失敗，沒有重試建立或執行任何 SQL。
- 新增 `lib/post-validation.ts`：Server Action 寫入前的執行時格式檢查（拒絕錯誤型別，檢查文章、標題、分類、標籤、UUID、日期、發布字數與過大正文）。
- 修正首頁重複／異常查詢字串可能讓 `q.trim()` 拋錯的狀況，搜尋／標籤值以第一個可用值和長度上限處理。
- 單元測試加入 `tests/*.test.mjs`，以 Node.js 24 內建測試工具運行，涵蓋文章建立／輸入、草稿／發布和不正確的 URL 查詢；均**不連線外部資料庫**。
- MSI 實測：`npm run test:unit` **14／14 通過**，`npm run typecheck` **exit 0**，`npm run build` **exit 0**（Next.js 16.4.0）。
- Node.js 內建 coverage 報告顯示**新抽離的兩個純函式模組** `post-validation.ts` 與 `search-params.ts` 為 100% 行、分支、函式覆蓋；**並非整站覆蓋率**。
- GitHub Actions PR CI 新增 `npm run test:unit`，與 TypeScript 及正式建置一起驗證；線上 CI 結果需以最新 commit 對應的 workflow run 為準。

## 尚未完成 / 限制

- 尚未建立／指定 **Naosledge 專用 Supabase**，因此尚未測試真實登入、CRUD 與 RLS 端到端整合。
- 尚未部署 Vercel；網站無真實資料時不代表服務已上線。
- 沒有真實 iPhone/Safari、Android Chrome、Lighthouse 或 VoiceOver/TalkBack 驗收。
- 2026-10-14 的離線預覽文章／發布／儲存皆為瀏覽器內的**示範資料**，不代表正式站長權限已驗證。
