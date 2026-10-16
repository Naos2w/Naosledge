# Naosledge — Vercel Hobby Preview（僅連 Neon Sandbox）

更新：2026-10-16。**目前尚未建立 Vercel 專案或部署 Preview。** Vercel 連線可讀取團隊與 GitHub，但建立專案時回傳 `403 forbidden`；MSI 未安裝／登入 Vercel CLI。這是待 Owner 修正的 Vercel 權限限制，不代表已部署，也不需先升級付費方案。

## 已確認且維持不變的限制

| 項目 | 確認 |
|---|---|
| Vercel 團隊 | `Naos Tsai's projects`（`team_SKDb8G0zLiz5vU36JEJUFzG9`） |
| Vercel 方案 | **Hobby 免費**，任何付費升級都不在授權範圍 |
| GitHub | [Naos2w/Naosledge](https://github.com/Naos2w/Naosledge)，PR #1 保持 Draft |
| 預覽來源 | **只有** `feat/initial-v3-site-20261015`；不從 `main` 執行 Production 部署 |
| 預覽專案名稱 | `naosledge-sandbox-preview` |
| Neon 專案 | `Naosledge`、`bitter-silence-36632892` |
| Neon Sandbox | **僅** `br-quiet-sunset-b4xx4pnx`；保留原先已驗證的 Auth / Data API |
| Neon Production | `br-aged-sound-b43h5r2c`，**不得**讓預覽連到此分支 |
| 站長帳號 | Production Auth 已建帳號但 Email 未驗證、密碼未設定；不得替其授權或重設 |
| 部署範圍 | 僅 Vercel Preview，不合併 PR，不建立公開正式網站 |

## 目前的阻礙

Vercel `create_project` 已**只在正確團隊**嘗試一次，回覆 `403: You don't have permission to create the project`。未建立專案、無預覽網址。依工具回覆，已核對 MSI 無可用 `vercel` CLI、無 Vercel CLI 登入狀態；未改用其他團隊／帳號。**等待 Owner 在 Vercel 釐清建立專案的權限或以正確團隊建立不自動發布 Production 的空專案。**

在權限修復前，只能準備、測試與提交 PR，不得假裝已部署或寄出郵件。

## Preview 安全設定（待有建立權限才執行）

1. 只在上述 Hobby 團隊建立 `naosledge-sandbox-preview` 專案並連接正確 GitHub repository；**建立時不要自動從 `main` 發布 Production**。確認 Vercel 專案 ID（`prj_...`）且分支來源仍是既有 Draft PR。
2. Vercel Preview 的登入保護優先使用 **Vercel Authentication**；若 Hobby 不支援所需保護且要收費，停止並由 Owner 決定。不要公開展示真實密碼或未發布文章。保留 SEO `noindex`、`robots.txt Disallow: /`。
3. 下列變數**只可指定 Preview Target**，不得加入 Production 或其他 Vercel 專案：
   - `NAOSLEDGE_BACKEND=neon`
   - `NEXT_PUBLIC_NAOSLEDGE_BACKEND=neon`
   - `NAOSLEDGE_NEON_BRANCH_ID=br-quiet-sunset-b4xx4pnx`
   - `NEON_AUTH_BASE_URL`：Neon Sandbox **Auth** 的官方 HTTPS URL，絕不可填 Production Endpoint
   - `NEON_DATA_API_URL`：Neon Sandbox **Data API** 的官方 HTTPS URL
   - `NAOSLEDGE_PREVIEW_PROJECT_ID`：**剛建立的該 Vercel 專案 ID**，用來與 Vercel 系統提供的 `VERCEL_PROJECT_ID` 比對
   - `NEON_AUTH_COOKIE_SECRET`：在安全環境產生高熵隨機字串（至少 32 字元），**只存 Vercel Preview Server-side Encrypted/Sensitive**，不得寫進 Git、PR、CI、聊天或公開變數
4. Vercel 自動提供 `VERCEL_ENV`、`VERCEL_GIT_COMMIT_REF`、`VERCEL_PROJECT_ID`、`VERCEL_BRANCH_URL`。應用程式會拒絕不是 **Preview + 特定開發分支 + 專案 ID 一致 + `naosledge-sandbox-preview-*.vercel.app`** 的回呼，並在伺服器端再次核對已核准的 Neon Sandbox 分支／兩個服務端點。
5. **不要為 Preview 設正式 `NEXT_PUBLIC_SITE_URL`**。就算誤填 HTTPS，Preview 也不會發布 SEO canonical／Sitemap；密碼重設信的回呼 URL 一律由受驗證的 Vercel 分支網址組成。
6. 真正部署完成且取得**確切**分支 HTTPS Origin 後，才在**Neon Sandbox** Auth Trusted Domains 新增這個精確來源，絕不更動 Production Auth。必須核對寄件端點、驗證信的受信任來源與使用者手上的 URL 一致。任何部署 URL 變動需重新確認，不能猜測網域。
7. 先執行不會寄信的 Preview 瀏覽器 Smoke，並查明 Vercel Preview Protection 不會阻斷使用者從郵件開啟重設頁；獲准後再使用 **Sandbox 合成測試帳號** 驗證真正寄信、失效 Token、不存在的帳號與完成後安全清理。**不得借用 Production 的真實站長帳號作 Sandbox 測試。**

## 已完成的離線測試（不依賴 Vercel）

- `npm run test:unit`：包含合法／不合法的 localhost 與固定 Vercel Preview 回呼網址、各種來源注入、分支與專案 ID 不相符、SEO noindex。
- `npm run typecheck`、`npm run build`。
- `npm run test:browser:local`：原本 Supabase 相容模式的瀏覽器回歸。
- `npm run test:browser:neon-recovery:local`：本機 Neon Sandbox 密碼頁 UI Smoke，**不發出 Auth / Data API 呼叫，也不寄信**。

## 邊界

「密碼設定成功」**不等於**「Email 所有權驗證成功」或「站長授權完成」。Neon Production 的註冊／Email 驗證政策、正式站長資料、Production 網站模式、PR 合併與正式發布仍需其他明確授權。
