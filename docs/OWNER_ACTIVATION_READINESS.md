# Naosledge — Owner Activation / Production Auth 安全準備

更新日期：2026-10-17。開發分支 `feat/owner-activation-20261017`，以 [PR #2](https://github.com/Naos2w/Naosledge/pull/2) 的 Private Vault 工作為基底。**帳號本人已完成正式 Email 驗證與密碼設定，後驗確認成功；此頁後續會重新關閉，不代表正式網站或站長權限已發布。**

## Production 現狀與邊界

Naosledge Neon Project `bitter-silence-36632892` Production `br-aged-sound-b43h5r2c` 已完成 002 Private Vault Migration，但站長未啟用。既有 Owner 帳號已由本人完成驗證：Neon Production 讀回 `emailVerified=true`、Credential Password 1 筆、`blog_admins=0`。Auth 設定 `allow_sign_up=false`、`allow_localhost=false`；但 `require_email_verification=false`、`verify_email_on_sign_in=false`，Neon Console 此版本沒有獨立強制驗證開關。正式權限仍由網站的 Email 已驗證檢查與 RLS 雙重保護。

既有 Vercel 專案為 `naosledge`（`prj_JEXZkiab0njUM7VWFhDO0NhL0GtH`），原 PR #1 Preview **只連 Neon Sandbox**。新的 Production Auth 啟用功能**不可**錯接 Sandbox Auth／密碼回呼，也不可將 Production Neon Data API 暴露到 Sandbox Preview。PR #1／#2／此新開發分支均不合併、也不部署正式站點，除非 Owner 另行核准。

## 已新增的防護

- `lib/neon/admin-identity.ts`：Neon 站長登入除需官方 JWT 與 `blog_admins` RLS 驗證，另外強制 `session.user.emailVerified === true`，杜絕 Neon 設定尚未強制驗證 Email 時的不合格登入。只有明確設定 flag 的 **MSI localhost + exact Neon Sandbox + 保留的 @example.com 合成測試帳號** 可以在本機 E2E 使用尚未驗證的 Email；Vercel/Production、真實 Email 或其他端點不能使用例外，且 RLS Admin Row 仍不可缺。
- `/owner-activation`：Owner 專屬的驗證信申請、OTP 驗證及首次密碼設定通知。Recipient 是加密 Preview 環境變數指定的既有 Owner Email，不能讓訪客任意輸入收件地址或回呼網址。所有郵件功能都交由官方 **Neon Managed Better Auth** 處理。
- `/owner-activation/reset`：一次性 token 只在瀏覽器 hydration 後讀取，**不會出現在 React Server Component HTML props**；讀取後立刻從瀏覽器 URL/history 移除，不印出 token。由官方 Neon Auth 驗證及消耗 token。使用者自行設定密碼；程式不記錄密碼或驗證碼。
- `/owner-activation/verified`：Email 連結驗證回呼頁，但**不以頁面到訪當作驗證成功**；僅由後續 Neon Auth 使用者實際 `emailVerified` 紀錄確認。
- `proxy.ts`：帳號啟用頁以獨立路徑跳過 Supabase／Sandbox Session；加入 `Cache-Control: private, no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex, nofollow, noarchive`。
- `vercel.json`：此新功能分支 **禁用 Git 自動部署**，不影響 PR #1 既有 Sandbox Preview。正式 URL 未獲準前，沒有新的線上入口。
- **Fail-closed**：如果不符合 Vercel `VERCEL_ENV=preview`、精確 Vercel 專案 ID、精確 feature branch、HTTPS `VERCEL_BRANCH_URL` 與相同的環境變數 origin，任何 Owner Activation 路由都返回 404，Server Actions 也拒絕實際寄信／重設；在 Vercel Production、localhost、其他專案及錯誤 Host 下均不可運作。

## Vercel Owner Activation Preview（已完成部署設定，等待本人收信驗收）

**2026-10-17 Owner 已明確核准**在現有 Hobby 專案建立受 Vercel Authentication 保護的專用 Preview，只連正式 Neon Managed Auth；未核准 Production 網站發布、PR 合併或正式站長權限。Vercel 專案 ID `prj_JEXZkiab0njUM7VWFhDO0NhL0GtH` 的 SSO 保護已唯讀確認。

已用 Vercel API 將 Owner Activation 的 **5 項加密環境變數**限制到 **Preview target + `feat/owner-activation-20261017` 分支**：啟用開關在帳號本人操作完成後已重新設定 `0`（須透過新 Preview 建置才會讓既有線上執行個體停用）、唯一 Production Auth URL、既有 Owner Email、隨機 Cookie Secret，以及經 Vercel 部署 Alias 確認的 `NAOSLEDGE_OWNER_ACTIVATION_ORIGIN=https://naosledge-git-feat-owner-activation-8d4805-naos-tsais-projects.vercel.app`。唯讀查核 Production Env=0、原 PR #1 的 7 項 Sandbox 變數保持原狀。啟用開關只允許**由已登入 Vercel 的使用者自行點按**驗證信／密碼設定通知，不會在部署或測試時自動寄送郵件。

**部署歷程：** Vercel Connector 建立 Preview 的 API 一度回傳 HTTP 403；Owner 於 Vercel Dashboard 手動建立首個 Preview，Commit `2870e5b`。系統隨後唯讀確認正式分支 Alias `https://naosledge-git-feat-owner-activation-8d4805-naos-tsais-projects.vercel.app`，無登入請求會 302 轉向 Vercel SSO，且 Vercel Authentication 仍開啟。Agent 獨立修正程式對實際 Alias 的精確驗證，全部本機測試通過，並透過一次性允許此分支 Git 自動部署完成新版 Commit `7eb79f9`，Vercel Deployment `dpl_2ehU9DtumQaRQZNLEdfHgjy7Hq4q` **READY**、固定 Alias 指向新部署；已於 Neon **Production Auth Trusted Domains** 增加且讀回相同的唯一 HTTPS origin。**沒有寄送正式郵件、修改正式帳號資料或授予站長權限。** 由於 Vercel Connector 讀取受保護實際網頁仍因 SSO bypass API 403 被拒，網頁內容需由 Owner 自己登入確認，不可只憑 READY 宣稱完整 UI E2E 成功。

**本人啟用已完成（2026-10-17）：** Owner 自行在受 Vercel SSO 保護的 Preview 收信並完成驗證／設定密碼；Neon Production 唯讀確認 `emailVerified=true`、Credential 密碼已存在、`allow_localhost=false`。沒有讀取或接收 OTP、密碼或 Token。下一步先讓暫時性的啟用 Preview 停用寄信功能，再獲取**明確的正式 `blog_admins` 授權**，才可以建立第一筆管理員資料。未合併 PR，也沒有部署 Production 網站。

所有變數僅指定 Vercel `naosledge` 專案 Preview target、Git Branch `feat/owner-activation-20261017`。**不要加入 Production target，也不要複製 PR #1 Neon Sandbox 的 Data API／Cookie 設定。**

| 變數 | 用途 |
|---|---|
| `NAOSLEDGE_OWNER_ACTIVATION_ENABLED` | 明確設定 `1` 才啟用，事後應停用 |
| `NAOSLEDGE_OWNER_ACTIVATION_AUTH_URL` | **僅**已核對的 Naosledge Production Neon Auth HTTPS Base URL；程式硬性比對唯一已核准端點 |
| `NAOSLEDGE_OWNER_ACTIVATION_ORIGIN` | Vercel 真正建置完成且受保護的 **精確分支 HTTPS origin**，不得預先猜測網址 |
| `NAOSLEDGE_OWNER_ACTIVATION_EMAIL` | 唯一既有 Owner Email；僅用 Encrypted/Server-side Env 儲存，不寫入 Git |
| `NAOSLEDGE_OWNER_ACTIVATION_COOKIE_SECRET` | 至少 32 字元，從安全隨機來源產生，只存 Vercel Preview Encrypted Env，不寫入 Git |
| 系統提供 `VERCEL`、`VERCEL_ENV`、`VERCEL_GIT_COMMIT_REF`、`VERCEL_PROJECT_ID`、`VERCEL_BRANCH_URL` | 必須全部符合目前已建立的專案、Preview、分支與 origin；不接受客戶端任意修改 |

此分支的預覽頁須保留 **Vercel Authentication／Deployment Protection**，且先驗證能從使用者自己的 iPhone／Safari 登入查看。當且僅當實際 Deployment 的精確 HTTPS origin 已得到 Owner 核准後，才在 **Neon Production Auth Trusted Domains** 加入該唯一來源（不允許 wildcard／其他 Preview／localhost），並請 Owner 從 Neon Console 關閉正式分支的 Allow Localhost。不要點擊 `Disable Auth`。

### 原有帳號啟用順序

1. 經本人核准，於受保護的專用 HTTPS 頁向**既有信箱**申請 Email Verification；Neon Auth 的設定顯示 method 為 `otp`，頁面同時支援官方 OTP 或驗證連結。如果收到不符合預期的格式，停止，不要上傳或轉貼完整連結、驗證碼、密碼。
2. 使用者自行完成 Neon 官方 Email 驗證。**由 Neon Connector 唯讀查核 `emailVerified=true` 才能進下一階段授權**。驗證畫面不能單獨當成成功證據。
3. 經本人操作申請首次設定密碼，按 Neon 發出的單次 HTTPS URL 自行設定。**由 Neon Connector 唯讀查核該帳號 Credential Password 已存在**。不重建帳號、不讀出雜湊、更不向 ChatGPT 索取任何秘密。
4. 確認兩者都成功後，再獲得 Owner 明確授權，以精確 Auth user ID 只對該人建立一筆 `blog_admins`，並獨立驗證實際登入、Session、JWT/RLS。此階段前 `blog_admins` 必須仍是 0。
5. 驗收完成後關閉 Activation 環境旗標，重新檢查 Vercel／Neon Trusted Domain、Session 和 HTTPS 的存取範圍。另行評估 PR 合併與網站正式發布，不能由這次測試推定已批准 Production Deployment。

## 目前可重現的驗證

- `npm run test:unit`：含精確 Vercel Preview/env/HTTPS/recipient 與錯誤 Token/OTP 驗證、未驗證 Email 的站長登入拒絕，及本機合成 E2E 例外永不適用於 Vercel/Production。
- `npm run typecheck`、`npm run build`。
- `npm run test:browser:local`：正式入口未啟用時，`/owner-activation`、`/owner-activation/reset`、`/owner-activation/verified` 都返回 404，且不得快取／外洩參照。
- **Neon Sandbox 人工 API 測試**：於 `br-quiet-sunset-b4xx4pnx` 用空密碼的合成 `@example.com` 使用者，呼叫 `send-verification-email`、`request-password-reset` 都回傳 HTTP 200。合成帳號已刪除、Sandbox `user=0`、`blog_admins=0`、`knowledge_notes=0` 已唯讀確認。**200 只表示請求被接受，不代表郵件確實送達，更不代表連結／OTP 已通過驗證。** 沒有寄送任何郵件給真實 Owner Yahoo 信箱，也沒有讀取或使用生產環境的 Token。

**最新進度：** 用戶已完成正式 Email 驗證與密碼設定，Neon 唯讀證據為 `emailVerified=true`／Credential Password 1 筆，且 Production `Allow Localhost=false`、註冊關閉，真正 `blog_admins` 仍為 0。已將專用 Preview 的 Activation Encrypted Env 旗標調回 `0`；待後續 Preview 建置完成才能宣稱線上寄信功能實際停用。受保護的暫時性 Trusted Domain 將於收尾時撤銷。正式站長授權、PR 合併與正式網站部署都尚未獲得另行核准。
