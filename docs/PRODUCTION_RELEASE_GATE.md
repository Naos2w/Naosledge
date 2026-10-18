# Naosledge 正式發布安全閘門 — 維護與發布前歷史

**現況：2026-10-18。** Owner 已授權並完成正式發布，並另行核准改用 [Naosledge 短網址](https://naosledge.vercel.app) 為正式 canonical，原長網址改為永久轉址。原已部署的 `main` 為 `56dcfe316d217bca51bcd424416fafd33caa12b2`，並完成本人站長登入驗收。Vercel Production 的核准 SHA、Neon Auth/Data API 配對與功能開關均已配置，Preview 仍受 SSO 保護。日後更新 `main` **必須先處理 `NAOSLEDGE_PRODUCTION_RELEASE_SHA` 的精確版本配對及發布步驟**，否則新部署會 fail-closed 為 HTTP 503。不要為了暫時開站而關閉保護。

**以下為 2026-10-17 正式發布前的歷史規格與核准關卡**，其中「尚未設定」「尚未上線」「待核准」等描述只反映當時狀態，不是目前的 Production 實際狀態。不得因歷史已核准項目而推定可改資料庫、付費方案或私密資料。

## 2026-10-17 發布前規格與驗證紀錄

- 既有 PR [#1](https://github.com/Naos2w/Naosledge/pull/1) → #2 → #3 → #4 → #5 仍為 Draft，最後的 #5 私人 Preview 已經 Owner 真人驗收成功，測試筆記清理為 0，站長啟用旗標設為 `0` 且關閉版 Vercel Preview READY。
- Neon `Naosledge` Production 原有的 `001`、`002` Migration 已執行，10 項私人 RLS policies 與 1 筆正式站長授權已核對，不需要也**不應**重跑 Migration。
- 暫時的 Neon Auth Preview Trusted Domain 已清空；正式網站尚未取得自己的可信域名與公開部署授權。
- Production gate 在未開啟時會直接阻擋所有一般應用程式請求，回傳 HTTP `503`、`no-store`、`no-referrer`、`noindex`；Server Actions / backend 選擇也不會默默回退到舊 Supabase。
- 已準備 Production 專屬 Neon 後端模式，只接受**同一個**已知正式 Neon Auth 與 Data API 端點，不允許用 Sandbox Auth 配正式 Data API，亦不繼承私人驗收 Preview 旗標。
- 正式版在另行批准前仍關閉密碼重設／啟用功能，不能把原本的測試用 callback 搬到 Production。

## 精確發布閘門契約

正式發布要同時滿足以下所有條件，任一缺失即 fail-closed。這些欄位現在**尚未在 Vercel Production 設定**：

| 條件 | 要求 |
|---|---|
| Vercel 專案 | `prj_JEXZkiab0njUM7VWFhDO0NhL0GtH`，現有 `naosledge` 專案 |
| 環境 | `VERCEL=1`、`VERCEL_ENV=production`、`NODE_ENV=production` |
| Git Branch | `VERCEL_GIT_COMMIT_REF=main` |
| 確切版本 | `NAOSLEDGE_PRODUCTION_RELEASE_SHA` 需為 Owner **另行核准的真實 main 完整 SHA**，與 Vercel 系統提供的 `VERCEL_GIT_COMMIT_SHA` 完全相同 |
| 明確啟用 | `NAOSLEDGE_PRODUCTION_ENABLED=1`，未設定或 `0` 都拒絕服務 |
| 資料庫 | `NAOSLEDGE_BACKEND=neon`、`NEXT_PUBLIC_NAOSLEDGE_BACKEND=neon`、`NAOSLEDGE_NEON_BRANCH_ID=br-aged-sound-b43h5r2c` |
| Neon Auth | 唯一核對過的 `ep-purple-recipe-b43kznn2` HTTPS Better Auth 端點 |
| Neon Data API | 同一正式分支的 `ep-purple-recipe-b43kznn2` HTTPS PostgREST 端點 |
| 正式域名 | `NEXT_PUBLIC_SITE_URL` 與 `NAOSLEDGE_PRODUCTION_ORIGIN` 都須匹配當前候選 `https://naosledge-naos-tsais-projects.vercel.app` |
| Cookie | `NEON_AUTH_COOKIE_SECRET`：至少 32 字元的**新產生、高熵、server-only** 值，絕不可寫入 Git、PR、CI 輸出或聊天 |
| 不相容狀態 | 舊 `NAOSLEDGE_VAULT_PREVIEW_ENABLED=1` 或 `NAOSLEDGE_OWNER_ACTIVATION_ENABLED=1` 不得與 Production 並存 |

**注意：**上述 `.vercel.app` 僅是 Vercel 現存專案顯示的候選網域，**不是 Owner 已選定的正式公開網址**。目前專案 SSO 保護涵蓋 `.vercel.app`；若最終要公開閱讀，Owner 必須選擇正式網域及可接受的 SSO 公開存取策略，再審核變更精確 Origin pin。本次不解除 SSO。

## 已通過的離線保護驗證

- `npm run test:unit`：包含 Production SHA、Vercel 專案、環境、URL 配對、SSO Preview 隔離、未授權主動回退與 SEO 的拒絕測試；所有輸入都為合成。
- `npm run typecheck`、`npm run build`：不需實際 Neon 帳號與 Token。
- `npm run test:release:closed:local`：使用已建好的 Next.js Production Server，以**假的 Vercel Production 元資料及無憑證模式**啟動，只綁定本機 `127.0.0.1`，驗證首頁、登入、Studio、Private Vault、筆記、Robots/Sitemap、郵件回復等 10 個路由均 HTTP 503、no-store、noindex。不能將本地模擬當成真正已上線 E2E。
- 不觸發 GitHub Actions / Vercel 建置，不寄信、不觸 Neon Production，不使用 Claude／Copilot。

## 剩餘的正式發布關卡（需 Owner 下一次明確授權）

1. **合併審查：** 依序檢查並整合 PR #1 → #2 → #3 → #4 → #5 → 本 Release Gate PR，確認 `main` 的最後 SHA。不是看到 Draft 內部測試通過就直接 squash merge。
2. **正式網址及公開方式：** Owner 決定使用既有 Vercel domain 或獨立網域、是否對一般訪客公開，確認 Vercel Hobby 方案與安全政策符合需要。若網域不同，先更新本 gate 的精確清單、重跑測試，再議是否部署。
3. **正式變數與 trusted origin：** 只在指定 Vercel 專案的 Production target 由核准的 Owner 操作／授權設定，保持新 Cookie Secret 在加密儲存。精確域名與 SSO 檢查完成後，僅將該 HTTPS origin 加入 Neon Production Auth Trusted Domains（不能 wildcard 或 localhost）。絕不沿用舊私人 Preview Trusted Domain。
4. **正式發布：** 以經核准 SHA 建立／升級**正式** Vercel deployment，驗證正確的 Region、Build、HTTP 安全性、匿名只可看已發布文章、未登入不得看私人筆記或 Studio。真實帳號 Session、JWT/RLS、草稿、公開／下架操作由 Owner 明確授權後再驗收。
5. **回復計畫：** 記錄前一版 deployment、Vercel domain assignment 及功能開關；失敗優先關閉 `NAOSLEDGE_PRODUCTION_ENABLED` 並部署關閉版（或回滾至已驗證的建置），**不刪除 Production DB／Neon Auth**。注意 Vercel rollback 可能停用後續自動 domain assignment，需確認狀態。

## 不包含於這次發布前置的工作

P4 AI 語意向量搜尋、AI 自動摘要與問答、Obsidian 雙向同步、中文大規模分詞索引目前尚未實作。這些是未來功能階段，不應因安全發布準備通過就宣稱已完成整個 AI 第二大腦。
