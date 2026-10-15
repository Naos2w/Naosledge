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

## 2026-10-15：手機編輯器與無資料庫 Chrome 驗收

- 依據已安裝的 `ui-ux-pro-max`、`design-director`、`motion-design` 規範，在正式寫作編輯器新增六個 Markdown 快捷按鈕：標題、粗體、斜體、清單、連結、程式碼；支持 `Ctrl/⌘+B`、`Ctrl/⌘+K`、已選文字包裹與選取範圍復原。
- 手機工具列在 375px 寬度橫向捲動，按鈕最小觸控高度 44px；正文仍維持可閱讀的實色背景與 reduced-motion 既有設定。
- 本機草稿除 700ms debounce 外，也在輸入欄位失焦、返回工作室及頁面 pagehide 時嘗試立即暫存；暫存失敗會正確回報，**不會當作已同步雲端**。
- 已發布文章的操作由「儲存草稿」改成明確「下架為草稿」，需先確認才可執行，避免意外下架。
- 新增 `tests/markdown-editor.test.mjs`；MSI 本機 Node.js 24 單元測試擴充至 **23／23 通過**。
- 安裝並鎖定 `playwright-core` 供**MSI 本機**執行 `npm run test:browser:local`，此指令使用已安裝的 Chrome／Edge，以及兩個**只綁定 127.0.0.1** 的臨時服務（Next dev + 假 Supabase），不連任何正式資料庫。
- 實際 Chrome Smoke **exit 0**：首頁 1440／1024／768／375px 無水平溢出、搜尋、標籤、Markdown 閱讀、明暗主題保存、reduced-motion、匿名工作室轉址，模擬站長登入，手機編輯器工具列與預覽，快速離開後恢復本機草稿，下架確認可取消，以及透過**假 PostgREST 記憶體**完成草稿儲存→匿名 404→發布→匿名可閱讀。
- Chrome JavaScript `pageerror` 為零；截圖只在 MSI 暫存資料夾，不提交 GitHub。為避免 GitHub Actions 額外下載瀏覽器與增加執行時間，**本機瀏覽器 Smoke 不加入遠端 CI**。
- 上述「登入、草稿 404、發布」只驗證**合成假服務下的應用程式流程**，絕不代表真正 Supabase Auth／資料列政策（RLS）的安全驗收。

## 2026-10-15：SEO 安全預設與文章閱讀無障礙

- 新增 `lib/seo.ts` 將公開網域來源限制在**明確設定的 HTTPS 網域**，拒絕 localhost、IP、測試／範例網域、含路徑的錯誤網域與帳密網址。
- 網域尚未設定時：`robots.txt` 拒絕索引，`sitemap.xml` 不含 localhost 或示範文章，頁面無 localhost canonical、文章 JSON-LD；未來正式網域設定後才生成文章 canonical、Open Graph 分享欄位、Twitter 中繼資料和 BlogPosting JSON-LD。
- 搜尋／標籤結果設定 noindex，避免建立重複的搜尋索引。
- 使用 `React.cache` 降低同一篇文章的 metadata 與頁面重複查詢；此優化不取代正式資料庫效能測試。
- 文章 Markdown H1 轉為 H2，維持頁面文章標題唯一 H1；站內連結維持同分頁、外部連結採新分頁；表格在窄螢幕有可鍵盤聚焦的橫向捲動區。
- 35 天學習日曆由一張整體圖片語意改成逐日標示的可存取清單。
- `npm run test:unit` **29／29 通過**；`npm run typecheck`、`npm run build` **exit 0**；MSI 的 `npm run test:browser:local` **exit 0**，包含 SEO fail-closed、逐日活動標籤、標題階層、內外連結、可捲動表格、既有手機／編輯／發布合成流程與 JS error = 0。
- **未驗收範圍**：沒有實際正式網址、真實 Supabase 文章、Google Search Console 或搜尋引擎收錄；不可將本機 SEO 測試視為正式上線驗收。

## 2026-10-15：Markdown 圖片插入與安全顯示（離線）

- 新增 `lib/markdown-image.ts` 的圖片網址來源檢查，只接受 HTTPS 或站內以 `/` 開頭的圖片路徑；拒絕 HTTP／data／JavaScript／localhost／IP／憑證／不明來源，避免混合內容和誤發本地網路請求。
- 閱讀頁的 Markdown 圖片使用 `loading="lazy"`、`decoding="async"`、`referrerPolicy="no-referrer"`，保留作者的 alt 替代文字，支援從 Markdown title 顯示可讀圖說；行動裝置等比縮放且不裁切。
- 站長編輯器新增第七個「圖片」快捷按鈕，自選取文字帶入 alt，插入 URL 佔位符並選取該 URL；內文與前後段落保留正常換行；沒有新增任何圖床、上傳介面或正式資料庫依賴。
- 擴充單元測試至 **35／35 通過**，包含圖片插入字串、選取範圍和 URL 安全邊界；TypeScript 型別檢查通過。
- MSI 真實 Chrome + **僅限 127.0.0.1 的合成假 Supabase** 驗證 **exit 0**：手機 375px 圖片不溢出、HTTPS 圖片在 Playwright 攔截下成功載入（合成 SVG）、保留 alt／圖說、lazy/async/no-referrer 屬性、HTTP 不安全圖片未發出請求；原有登入、筆記編輯、假資料草稿／發布流程也維持通過。瀏覽器截圖僅在 MSI 暫存資料夾。
- 尚未用真實圖片伺服器、實際 Supabase Storage 或使用者上傳照片驗收；外部圖片伺服器仍可能取得讀者 IP，請依隱私需求選擇站內圖片。

## 2026-10-15：長文目錄、閱讀進度與複製程式碼

- 新增 `lib/article-outline.ts`：使用現有 unified/remark 解析 Markdown AST，為中文、英文、重複標題生成唯一錨點；fenced code 內的假標題不會出現在目錄。Markdown 標題與文章目錄使用同一個命名規則。
- 文章側欄新增「文章目錄」，小螢幕換成可水平捲動的觸控章節列；文章正文長度超出可視範圍時，頂端呈現不造成 React 捲動重繪的閱讀進度條。
- 新增 `components/code-snippet.tsx` 的一鍵程式碼複製及明確成功／失敗回饋，增加文章尾端「回到文章開頭」連結。
- MSI Node 單元測試擴充到 **42／42 通過**，涵蓋 Markdown AST 解析、Setext 標題、重複錨點、Unicode 及 fenced code；`npm run typecheck`、`npm run build` 本地通過。
- Chrome 真實瀏覽器搭配**僅限 127.0.0.1 的合成假 Supabase**執行 `npm run test:browser:local` 成功（exit 0）：長文章錨點可跳轉、手機章節按鈕至少 44px、閱讀進度會更新，複製程式碼能透過 Clipboard API 取得正確文字，既有搜尋／圖片／草稿流程亦通過。
- 本批測試屬 UI 與假資料流程，不代表真實 Supabase RLS 已驗收，亦不代表已在 iOS Safari 或 TalkBack 上執行實測。

## 尚未完成 / 限制

- 尚未建立／指定 **Naosledge 專用 Supabase**，因此尚未測試真實登入、CRUD 與 RLS 端到端整合。
- 尚未部署 Vercel；網站無真實資料時不代表服務已上線。
- 沒有真實 iPhone/Safari、Android Chrome、Lighthouse 或 VoiceOver/TalkBack 驗收。
- 2026-10-14 的離線預覽文章／發布／儲存皆為瀏覽器內的**示範資料**，不代表正式站長權限已驗證。
