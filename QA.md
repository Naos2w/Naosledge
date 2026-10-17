# Naosledge v3 — UI / QA 驗證

驗證日期：2026-10-14 起，最新更新 2026-10-16

## 2026-10-17：Vercel Preview 真實專案與 Neon Sandbox-only 設定（最新）

- Owner 已建立 `Naos Tsai's projects` Hobby 的 **`naosledge`**（`prj_JEXZkiab0njUM7VWFhDO0NhL0GtH`），Vercel 實測 Framework Next.js、Node.js 24.x、Vercel Authentication 已開啟。
- 同一專案的 `main` 首次 Production 部署狀態 **ERROR**（只包含 GitHub 初始 commit），PR #1 的 `feat/initial-v3-site-20261015` 分支則已有 **READY** Preview，固定 Alias `naosledge-git-feat-initial-v3-site-20261015-naos-tsais-projects.vercel.app`；不能將 Preview READY 混同正式站已上線。
- Vercel API 已成功寫入並**讀回確認** 7 個加密環境變數，全部 `target=preview`、`gitBranch=feat/initial-v3-site-20261015`，Production 環境變數為 0；Cookie Secret 由安全隨機來源產生，不記入 Git／CI。
- 修正先前預想的 `naosledge-sandbox-preview` 專案名稱：現在 Guard 必須精確核對**已存在的 Vercel Project ID、唯一固定 HTTPS Alias、原開發分支與 Preview Target**。同時繼續強制只連 `br-quiet-sunset-b4xx4pnx` Sandbox Auth 與 Data API。
- Vercel Connector 的受保護 Preview 實體網頁請求因 Deployment Protection 讀取權限 403，故**尚未完成網站 Runtime、密碼信、真實 Session／JWT／RLS 的線上驗收**；仍維持 Vercel SSO 保護，不為方便檢查而關閉。
- 後續新 Commit 觸發的 Preview-only 建置需再次比對 SHA／READY、檢查是否載入新的 Env；只有在確認線上 Runtime 後，才對 Neon **Sandbox** 設定精確 Trusted Domain、驗證合成帳號密碼恢復流程並清理，不得操作 Production Auth 或正式 Owner 站長帳號。
- MSI 額外以**模擬的 Vercel Preview 系統環境變數**（正確專案 ID、Feature 分支、固定 Alias）執行 `npm run test:browser:neon-recovery:local`：Next.js Chrome Smoke **exit 0**、頁面及 Token 驗證全部通過，且沒有發出 Neon Auth/Data API 呼叫；不代表已驗證 Vercel 線上網站。

## 2026-10-16：Vercel Hobby Preview — 授權已取得，建立權限受阻

- Owner 已授權僅在 **Vercel Hobby `Naos Tsai's projects`** 建立 `naosledge-sandbox-preview`，只部署既有 Draft PR 的 feature 分支，連接已核准的 Neon Sandbox，禁止動 Production Auth／站長授權／正式網站。Vercel Connector 唯讀確認 Hobby 方案、GitHub `Naos2w/Naosledge` 已可存取、同名專案不存在。
- 真正呼叫 Vercel `create_project` 一次，得到 **403 forbidden**（沒有建立專案權限），**沒有建立任何 Vercel 專案或部署**。核對 MSI 尚無 Vercel CLI 或本機登入狀態；不改用其他 Team 或付費方案，停止對外部署。
- 既有 PR 的程式新增明確的 Vercel Preview callback 驗證：只接受 `VERCEL_ENV=preview`、原 feature branch、Vercel 提供的 Project ID 與待設定的 `NAOSLEDGE_PREVIEW_PROJECT_ID` 相等，以及 `naosledge-sandbox-preview-*.vercel.app` 格式的 `VERCEL_BRANCH_URL`。Backend 持續硬性核對**唯一獲准 Sandbox branch、Auth 與 Data API**，禁止 Vercel Production 使用。
- SEO 預設 fail-closed：`VERCEL_ENV=preview` 時即使有人誤設 HTTPS `NEXT_PUBLIC_SITE_URL`，仍不產生 public canonical。所有回呼網址由受驗證的 Vercel branch metadata 產生，不讀請求 Host 或任意 `redirectTo`。
- MSI 新增惡意 callback、錯誤 project ID、main/production branch、假 hostname 等單元測試；`npm run test:unit`、`npm run typecheck`、`npm run build`、兩套本機 Chrome 回歸均通過。**這些都不是部署成功或真正 Email 重設驗證**。
- 完整待建置清單及 owner 權限阻礙見 [VERCEL_SANDBOX_PREVIEW.md](docs/VERCEL_SANDBOX_PREVIEW.md)。需先由 Owner 修正 Vercel 建立專案權限，再設定只限 Preview 的 Env 與秘密、Neon **Sandbox** Trusted Domain，才可能進行 Email 密碼恢復端到端驗證。

## 2026-10-16：站長帳號啟用 / 密碼恢復前置（Sandbox-only）

- 先前已依 Owner 提供的 Email，透過 Neon Connector **只在 Naosledge Production** 建立 1 位 Auth user；實體唯讀核對 Email 未驗證、credential account 的 password 仍為 NULL，`public.blog_admins=0`。**沒有設定或取得密碼，不得直接視為可登入站長**。
- Neon Console 僅顯示 Auth 設定，不保證有使用者密碼重設按鈕；依據本機已釘選的 `@neondatabase/auth@0.6.0-beta` 與 Better Auth 端點，透過 `requestPasswordReset`／`resetPassword` 建立自助設定流程，由 Neon 發送／核對一次性 Token。應用程式**不自製、不儲存 Token，也不寫入密碼資料庫**。
- 新增 `/forgot-password`、`/reset-password` 與登入頁入口；只在**已核准的 Neon Sandbox backend** 顯示。伺服器端檢查 Email、Token、12–128 字元的新密碼，回覆不揭露帳號是否存在的訊息；重設 Callback URL 嚴格限制為明確設定的 `http://localhost:<port>/reset-password`，不能由訪客指定外部網址。
- Reset Token 由 Better Auth 回傳並於瀏覽器頁面使用，頁面 Hydration 後清除 query string；不出現在 console、Git、CI、文件或伺服器錯誤訊息。
- MSI `npm run test:unit`、`npm run typecheck`、`npm run build` 通過；`npm run test:browser:neon-recovery:local` 的獨立 Chrome 測試 **NEON_RECOVERY_UI_SUCCESS**，驗證頁面、無效 Token 提示、雙重密碼不一致拒絕、網址 Token 清除，且**無 Auth/Data API 網路呼叫、沒有寄信／觸碰線上資料**。
- `npm run test:browser:local` 全套既有 Supabase 相容回歸 **exit 0**；新確認兩個恢復頁在 Supabase 相容模式均 404、登入頁不會顯示 Neon 重設入口。既有 Playwright 重複確認視窗處理競態一併修正。
- **剩餘待 Owner 授權與操作**：Production Auth 公開註冊／Email 驗證政策、可在 iPhone 開啟且與 Neon Trusted Domains 一致的 HTTPS 網站／預覽，以及由 Owner 本人點選重設信、設定密碼、確認 Email。**目前沒有真正寄出 Yahoo 重設信，也未在 Production 執行 Token 或密碼流程，更沒有站長權限、Vercel 部署、PR 合併。**
- 重要限制：**設定／重設密碼本身不會將 `emailVerified` 改成 true**；正式站長授權與登入測試前必須另行完成 Email 所有權驗證。

## 2026-10-15：Neon Production 經另行核准完成初始建置（最新狀態）

- 本次額外核准**只針對** Neon Free `Naosledge` Production branch `br-aged-sound-b43h5r2c` 的 Initial Migration 與 Data API；不含正式站長、Auth 安全政策、部署、PR 合併或其他專案。
- 執行前唯讀核對 `neondb` 無 `public.posts`／`blog_admins`，Data API 不存在；Better Auth 已存在。Data API 啟用時使用 `add_default_grants=false`、僅 `public` schema、匿名角色 `anonymous`、JWT role claim `.role`，狀態 active。
- 使用原本 GitHub PR #1 的 Migration blob `0b9c9057db3dea8d970e6a0fa5d6ef16aba26181`，校驗 21 項 DDL／RLS／GRANT，於 Production **單一交易執行成功**；沒有變更原始 SQL。
- 後驗：`posts=0`、`blog_admins=0`、兩張表 RLS enabled、5+1 policies、posts 5 個索引、更新 trigger 存在；匿名只能讀 posts、無權操作 admin 表；authenticated 寫文章仍依 RLS 站長身分，且無權修改 `blog_admins`。
- 唯讀比較 Sandbox／Production 應用結構一致，唯一 Schema 差異為 Production 額外禁用 Data API OpenAPI 模式；沒有新增合成帳號或正式文章，不宣稱 Production JWT／Next.js E2E 已完成。
- 目前免費方案維持兩個分支；沒有 Snapshot／排程記錄，未建立或刪除 Snapshot。網站程式仍然硬性限定 Sandbox，正式 Auth 安全政策、站長身分、真實網站驗收及部署待 Owner 另行決定。

以下為前序日期相同、不同階段的歷史驗收紀錄，當時「Production 未建立文章表」描述並非現在的狀態。

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

## 2026-10-15：不依賴資料庫的 Markdown 備份／還原

- 加入 `lib/markdown-backup.ts` 的純函式備份序列化、內容解析、可攜式檔名產生；Naosledge 自有的簡潔 YAML/JSON-scalar metadata header 記錄標題、網址、摘要、分類、標籤與日期，正文仍是原始 Markdown。
- 新增編輯器「下載 .md 備份」和「匯入 .md」按鈕，不需要任何 Storage；一般 Markdown 檔直接匯入正文，Naosledge 備份可恢復完整欄位。
- 匯入前需確認覆寫現有未發布內容，取消會保持原稿；檔案最大 1MB，正文最多 200,000 字元；匯入後只存本機草稿，強制維持 draft，**不會自動觸發 Supabase 上傳或發布**。
- 單元測試增加備份往返、繁體中文和特殊字元、Windows 換行、一般 Markdown 與錯誤／過大檔案測試，MSI 本機累計 **48／48 通過**。
- Chrome 本機合成 Auth／PostgREST 完整測試 **exit 0**：以實際下載事件取得備份、取消匯入保留原稿、確認匯入可還原內容與 slug，且匯入前後模擬資料筆數不變。既有目錄、閱讀進度、程式碼複製、圖片載入、手機版與假資料草稿發布流程皆通過。
- 備份下載是為降低本機草稿清除造成的資料遺失風險，**不是雲端儲存或同步**；本機檔案可能含私人未發布內容，須由使用者妥善保管。

## 2026-10-15：手機導覽可用性補強

- 先前手機版 `max-width:580px` 會隱藏 `.primary-nav`，但沒有提供等價導覽。新建 `components/mobile-nav.tsx`，以可存取的 `details/summary` 實作獨立手機選單，完整保留文章索引、學習足跡、關於頁連結。
- 使用者可用 Enter 開啟選單、Escape 收合、點擊連結跳轉後自動收合、點擊選單外區域收合；清楚的 focus-visible 樣式與至少 44px 觸控高度。
- 在不改變 Dark Liquid Glass 視覺語言的前提下，支援桌面導覽與手機選單分別顯示；極窄的 320px 版面縮減寫作按鈕文字而保留其可存取名稱。
- MSI Chrome 本機合成資料驗證 **exit 0**：320／375／768／1024／1440px 首頁沒有水平溢出、手機選單鍵盤切換／收合／跳頁正確，原有 SEO、長文章、圖片、備份、草稿與合成發布流程也全部通過。
- 尚未在真實 iPhone Safari、Android TalkBack 或 VoiceOver 驗收；瀏覽器測試只代表 MSI 上的 Chrome。

## 2026-10-15：Neon Free 後端整合前置與本機 PostgreSQL 權限驗證

- 使用者已自行建立 Neon Free 的「Naosledge」專案。連線後透過 Neon MCP **只讀**確認：`production` 分支 ready 但沒有保護；`neondb` 為 PostgreSQL 18.6，`public` 尚無應用表，`neon_auth` 為 Neon 管理的 Better Auth 資料表；Storage enabled 且沒有 Bucket，**Neon Data API 尚未建立**。
- Auth 配置已啟用 Email/Password，但**允許公開註冊，且沒有要求信箱驗證**；正式單一站長網站必須在驗收前處理。分支位於 AWS us-east-2，台灣訪客延遲日後需評估。
- 新增完全獨立的 `neon/migrations/001_initial_blog.sql` **待核准草案**，將 Supabase `auth.users` UUID 轉為 Neon Better Auth 的 `text` ID，並使用 Neon `anonymous`、`authenticated` 角色和 `auth.user_id()` 函數建立可公開閱讀／站長專屬寫入的最小 GRANT+RLS。沒有更動 `supabase/schema.sql`。
- 新增 `tests/neon-rls.test.mjs`，使用 `@electric-sql/pglite` 在**本機記憶體 PostgreSQL**執行 migration 及合成身份權限測試，包括：匿名只能讀公開文章、非站長不具寫入權限、站長讀草稿／新增／更新與防止冒用其他作者、不可自行授權站長、資料表限制。此測試**並非 Neon 線上 PostgreSQL 18 或 JWT 驗簽**。
- Neon Better Auth 官方 beta SDK 目前在 MSI 嚴格 npm 安裝遇到 Better Auth peer dependency 警告／逾時，**沒有強制接到登入路由**。
- 另新增未啟用的 `lib/neon/data-api.ts` 與合成 `tests/neon-data-api.test.mjs`，用獨立 Neon PostgREST SDK 驗證 URL、Bearer JWT 傳遞、查詢格式，以及 JWT 缺失時不得送出網路請求，**不連真實 Neon 端點**。
- 專用 Neon integration 文件：[`docs/NEON_INTEGRATION_READINESS.md`](docs/NEON_INTEGRATION_READINESS.md)。以上是**先前未獲授權時的歷史狀態**；使用者後續已授權並完成隔離分支真實測試，詳見下節。

## 2026-10-15：Neon Free 真正的隔離端對端測試

- 已獲使用者明確許可建立獨立分支 `br-quiet-sunset-b4xx4pnx`（不是 default/primary）。首度嘗試自訂 Free 休眠時間被 HTTP 412 拒絕，改用免費預設配置建立成功。
- 只在隔離分支啟用 Neon Data API，關閉預設自動 GRANT；21 個 Migration SQL 語句以單一 transaction 套用。Neon PostgreSQL 18.6 實際核對 posts 與 blog_admins 均啟用 RLS（文章 5 policies、站長表 1 policy）。
- 真實隔離 Auth JWT 與 Data API 驗證：匿名 JWT 可取得、匿名讀取 blog_admins 被 403/42501 拒絕；兩個 @example.com 合成帳號可登入取得真實 JWT；一般使用者不能新增或更新，授權合成站長可建立草稿、發布、公開讀取、刪除，且不能冒用他人作者 ID。
- 手動腳本 `scripts/verify-neon-sandbox.mjs` exit 0 且報告 `SANDBOX_SMOKE_SUCCESS`；未將任何臨時密碼、Cookie、JWT 或真實帳號資料寫入 Git。
- 驗收後清理兩個合成 Auth 帳號、合成站長授權及測試文章，Neon 真實 SQL 確認 posts=0、blog_admins=0、匹配合成 Auth users=0；保留空白隔離分支與 RLS 供後續用。
- 再次以 Neon Connector 唯讀確認 production 仍是預設分支、public 仍沒有 Naosledge 資料表；現有 Supabase、正式部署與 main 均未修改。
- Neon Auth 官方 beta SDK 重試標準 npm 安裝曾成功，但存在 Better Auth peer 相依警告；未經正式應用整合，已卸載避免 CI 額外引入約 201 個未使用依賴。

## 2026-10-15：Next.js 網站切換到 Neon Sandbox（真實瀏覽器）

- 使用者明確同意在既有 Draft PR #1 修改網站程式，建立 `NAOSLEDGE_BACKEND=neon` 的**可選測試模式**，且 `NEXT_PUBLIC_NAOSLEDGE_BACKEND` 必須一致；預設仍保留 Supabase 路徑作為回退。Neon 設定硬性限制原授權的 `br-quiet-sunset-b4xx4pnx` branch 與同一組 Auth/Data API endpoint，拒絕 production。
- 改接官方 `@neondatabase/auth/next/server` 伺服器端 SDK、HTTP-only Cookie、`proxy.ts` 的 Studio Middleware；由 Neon Auth `/get-session` 傳回真正簽署的 JWT，再交由 Data API/Postgres RLS 驗證站長權限，**不依賴本地自簽 JWT 或使用者可編輯 Email**。
- `lib/auth.ts`、`lib/posts.ts`、`app/actions.ts` 與原 Studio 頁面已能在 Sandbox 模式運作，包含登入、匿名公開查詢、草稿、發布、修改、刪除、登出；Supabase 舊路徑也維持可用。
- MSI Chrome 真實 Next.js + Neon Sandbox E2E，`NEON_WEBSITE_BROWSER_SUCCESS` / `SANDBOX_SMOKE_SUCCESS` **exit 0**：匿名不能進 Studio、非站長拒絕並登出、合成站長可以登入、真實 Server Action 儲存草稿、匿名草稿 404、發布匿名 200、修改同步、刪除匿名 404、登出後拒絕；瀏覽器 JavaScript 錯誤數 0。
- 驗後已刪除 2 位臨時 Better Auth 合成使用者、臨時站長授權與文章，Neon 線上確認 `posts=0`、`blog_admins=0`、合成 Auth users=0；再次核對 `production` 未建立文章表，也未動現有 Supabase。
- 正式建置在 Neon Sandbox 環境亦已編譯成功，並修正登入與新增筆記頁需 `dynamic = "force-dynamic"` 的預渲染警告；新建 `tests/backend.test.mjs` 驗證後端模式須明確一致。
- Auth 官方 beta SDK 已成功安裝並實測 HTTP-only Cookie；npm 曾有 Better Auth peer 相依警告，正式發布前仍須再次追蹤相容性、安全稽核與部署環境設定。

## 尚未完成 / 限制

- **當次 Sandbox 的實際網站整合已完整通過**；其後又獲另行核准完成 Neon `production` 的文章資料表／RLS／Data API，但正式 Auth 安全政策、真實站長帳號及網站部署仍未完成。
- 尚未部署 Vercel；網站無真實資料時不代表服務已上線。
- 沒有真實 iPhone/Safari、Android Chrome、Lighthouse 或 VoiceOver/TalkBack 驗收。
- 2026-10-14 的離線預覽文章／發布／儲存皆為瀏覽器內的**示範資料**，不代表正式站長權限已驗證。
