# Naosledge — Owner Activation / Production Auth 安全準備

更新日期：2026-10-17。開發分支 `feat/owner-activation-20261017`，以 [PR #2](https://github.com/Naos2w/Naosledge/pull/2) 的 Private Vault 工作為基底。**這是受保護 HTTPS 帳號啟用的候選實作，不是已啟用的正式流程**。

## Production 現狀與邊界

Naosledge Neon Project `bitter-silence-36632892` Production `br-aged-sound-b43h5r2c` 已完成 002 Private Vault Migration，但站長未啟用。既有 Owner 帳號目前 `emailVerified=false`、沒有 Credential Password，`blog_admins=0`。Auth 設定 `allow_sign_up=false`，但 `require_email_verification=false`、`verify_email_on_sign_in=false`；Neon Console 此版本沒有可供設定後兩者的介面選項。Production Trusted Domains 目前為空，`Allow Localhost` 仍然啟用。

既有 Vercel 專案為 `naosledge`（`prj_JEXZkiab0njUM7VWFhDO0NhL0GtH`），原 PR #1 Preview **只連 Neon Sandbox**。新的 Production Auth 啟用功能**不可**錯接 Sandbox Auth／密碼回呼，也不可將 Production Neon Data API 暴露到 Sandbox Preview。PR #1／#2／此新開發分支均不合併、也不部署正式站點，除非 Owner 另行核准。

## 已新增的防護

- `lib/neon/admin-identity.ts`：Neon 站長登入除需官方 JWT 與 `blog_admins` RLS 驗證，另外強制 `session.user.emailVerified === true`，杜絕 Neon 設定尚未強制驗證 Email 時的不合格登入。只有明確設定 flag 的 **MSI localhost + exact Neon Sandbox + 保留的 @example.com 合成測試帳號** 可以在本機 E2E 使用尚未驗證的 Email；Vercel/Production、真實 Email 或其他端點不能使用例外，且 RLS Admin Row 仍不可缺。
- `/owner-activation`：Owner 專屬的驗證信申請、OTP 驗證及首次密碼設定通知。Recipient 是加密 Preview 環境變數指定的既有 Owner Email，不能讓訪客任意輸入收件地址或回呼網址。所有郵件功能都交由官方 **Neon Managed Better Auth** 處理。
- `/owner-activation/reset`：一次性 token 只在瀏覽器 hydration 後讀取，**不會出現在 React Server Component HTML props**；讀取後立刻從瀏覽器 URL/history 移除，不印出 token。由官方 Neon Auth 驗證及消耗 token。使用者自行設定密碼；程式不記錄密碼或驗證碼。
- `/owner-activation/verified`：Email 連結驗證回呼頁，但**不以頁面到訪當作驗證成功**；僅由後續 Neon Auth 使用者實際 `emailVerified` 紀錄確認。
- `proxy.ts`：帳號啟用頁以獨立路徑跳過 Supabase／Sandbox Session；加入 `Cache-Control: private, no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex, nofollow, noarchive`。
- `vercel.json`：此新功能分支 **禁用 Git 自動部署**，不影響 PR #1 既有 Sandbox Preview。正式 URL 未獲準前，沒有新的線上入口。
- **Fail-closed**：如果不符合 Vercel `VERCEL_ENV=preview`、精確 Vercel 專案 ID、精確 feature branch、HTTPS `VERCEL_BRANCH_URL` 與相同的環境變數 origin，任何 Owner Activation 路由都返回 404，Server Actions 也拒絕實際寄信／重設；在 Vercel Production、localhost、其他專案及錯誤 Host 下均不可運作。

## 唯一允許的日後 Preview 設定（尚未套用）

以下**全部只指定 Vercel `naosledge` 專案的 Preview target、Git Branch `feat/owner-activation-20261017`**。設定前先獲得 Owner 對「將正式 Auth 連接到受保護 Preview 以執行個人帳號啟用」的明確授權。**不要填 Production target，也不要複製 PR #1 Neon Sandbox Data API／Cookie 設定。**

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

**尚未完成／需要 Owner 下一次介入**：確認可使用的受保護 Vercel HTTPS Preview、授權 Preview 只連正式 Neon Auth 進行既有帳號啟用；之後實際郵件必須由本人操作。Neon Production 私人知識庫 Migration 已完成，但正式站長帳號仍未啟用，網站正式部署也未獲授權。
