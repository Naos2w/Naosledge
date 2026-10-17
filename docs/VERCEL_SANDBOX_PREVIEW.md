# Naosledge — Vercel Hobby Preview（只連 Neon Sandbox）

更新：2026-10-17。**Owner 已在原有 Hobby 團隊內建立 `naosledge`；PR #1 的開發分支已有 READY 的 Preview，與 `main` 正式環境分開。** 不能把 Preview READY 當作真正 Neon Auth／密碼郵件端到端測試成功；仍需檢查 Preview Server Runtime 和受保護頁面的實際行為。

## 最新已驗證的專案／環境

| 項目 | 現況 |
|---|---|
| Vercel Team | `Naos Tsai's projects`，`team_SKDb8G0zLiz5vU36JEJUFzG9`，**Hobby Free** |
| Project | `naosledge`，`prj_JEXZkiab0njUM7VWFhDO0NhL0GtH`，Next.js、Node.js 24.x |
| GitHub repository | `Naos2w/Naosledge` |
| Vercel Production branch | `main`，首次部署從 GitHub 初始 commit 建置為 **ERROR**；不能視為正式站已完成 |
| Preview source branch | `feat/initial-v3-site-20261015`，PR #1 **Draft**、未合併 |
| Preview branch URL | `https://naosledge-git-feat-initial-v3-site-20261015-naos-tsais-projects.vercel.app` |
| Preview deployment | 已有 **READY**（最初觀察的是 `c21a639`），後續提交需確認新部署 SHA／Runtime |
| Deployment protection | Vercel Authentication 已啟用：`all_except_custom_domains` |
| Neon Sandbox | 獲准的 `br-quiet-sunset-b4xx4pnx` |
| Neon Production | `br-aged-sound-b43h5r2c`；**不可**用在 Preview |
| 正式站長帳號 | Production Auth 1 位尚未啟用，沒有密碼／驗證／`blog_admins` 授權 |
| Preview webhook / email | 尚未真實寄信；不得用正式 Yahoo 帳號做 Sandbox 測試 |

Vercel 連線先前因建立專案 API 403 失敗，後續 Owner 自行在 Vercel Dashboard 匯入 GitHub 後，已**從帳號的完整專案清單與 Vercel Deployment／Alias** 核對專案存在。舊版文件記錄的 `naosledge-sandbox-preview` 是未建立成功的規劃名稱，不是現有專案。

## 實際的 Preview 環境變數

已在 **正確專案** 的 **Preview target** 建立、且 Git Branch 精確限定 `feat/initial-v3-site-20261015`，其他分支及 Production 不共用：

- `NAOSLEDGE_BACKEND=neon`
- `NEXT_PUBLIC_NAOSLEDGE_BACKEND=neon`
- `NAOSLEDGE_NEON_BRANCH_ID=br-quiet-sunset-b4xx4pnx`
- `NEON_AUTH_BASE_URL`：已核對的 Sandbox Neon Auth HTTPS Endpoint
- `NEON_DATA_API_URL`：已核對的 Sandbox Neon Data API HTTPS Endpoint
- `NAOSLEDGE_PREVIEW_PROJECT_ID`：`prj_JEXZkiab0njUM7VWFhDO0NhL0GtH`
- `NEON_AUTH_COOKIE_SECRET`：高熵隨機值、Vercel Preview encrypted、**沒有**寫入 Git／CI／聊天／本機環境檔

Vercel 已讀回**7 項**全數為 `target=[preview]`、`gitBranch=feat/initial-v3-site-20261015`，且 Production 環境變數筆數為 0。環境變數的新設定要到**下一次 Preview 部署**才會生效，不表示之前的 READY build 已讀取到變數。

**嚴禁**把 Preview 的任何變數複製到 Production 或連接已啟用正式 Migration 的 Neon 分支。

## Runtime 防呆與安全驗證

1. 伺服器先檢查 `VERCEL_ENV=preview`、`VERCEL_GIT_COMMIT_REF` 精確等於 PR 開發分支、`VERCEL_PROJECT_ID` 和 `NAOSLEDGE_PREVIEW_PROJECT_ID` **同時等於目前實際的 Vercel 專案 ID**，並檢查 `VERCEL_BRANCH_URL` **精確等於**上面的固定 HTTPS 分支 Alias。其任一值不存在或不符，**fail closed**。
2. `lib/neon/config.ts` 額外檢查 Neon Auth 和 Data API 都屬於**唯一已授權 Sandbox endpoint**，禁止 `production` branch、錯誤 hostname、含憑證或不安全 URL。
3. 密碼恢復 `requestPasswordReset` 使用受驗證的 Vercel branch HTTPS origin，**不用**不受信任的 Host header 或使用者指定的回呼。
4. `VERCEL_ENV=preview` 時 SEO 不產生公開 canonical／Sitemap，`robots.txt` 預設 `Disallow: /`。
5. Preview 維持 Vercel Authentication 保護。由於目前 Vercel 整合嘗試讀取受保護 Deployment 時遇到 403，尚**不能聲稱本工具已實際載入網站頁面或登入**。Owner 可在有權限的 Vercel 帳號中點開上方 HTTPS 分支網址，提供安全的結果描述／去敏截圖。

## 下一步：預覽實體驗收

- 以精確的 PR 新 Commit 觸發 Preview-only 新部署，核對 SHA、READY、Framework、Server Runtime。不能用 `main` 的初始失敗 build 當成 Preview 驗證。
- Preview 新部署成功後，再對 Neon **Sandbox** 的 Auth Trusted Domains 加入**確切**分支 HTTPS origin，不更動 Production Auth。實體測試使用合成帳號，不能拿真實 Owner 帳號當測試。
- 檢查受保護網站的公開頁、`/login`、`/forgot-password`、`/reset-password`（含無效 token），確保沒有 secret 洩漏。之後才做獲授權的合成郵件、一次性 Token 及清理驗證。
- 正式站長的 Email 驗證和密碼設定、Production Auth 安全政策、PR 合併、Neon Production 網站模式與正式網域均屬**後續獨立關卡**，不能由 Preview 的核准推定。
- **保持免費**：若任何措施需要 Vercel / Neon 付費，停止並先由 Owner 決定。

本機驗證：`npm run test:unit`、`npm run typecheck`、`npm run build`、`npm run test:browser:local` 與 `npm run test:browser:neon-recovery:local`。另已於 MSI 注入**模擬的** Vercel Preview 系統變數（精確 Project ID、Branch、HTTPS Alias），Chrome 本機驗證 `NEON_RECOVERY_UI_SUCCESS`、未發出 Auth/Data API 呼叫。這些測試不能代替受 SSO 保護的 Vercel 線上 Preview 實際驗收。
