# Naosledge — Private Vault 線上 Preview 驗收（限定授權）

建立：2026-10-17。目標是**既有 Vercel Hobby 專案的 SSO 保護 Preview**，允許已驗證且擁有 RLS 管理員權限的 Owner 本人驗證私人筆記，不是公開網站上線。

## 精確環境與權限

| 項目 | 僅允許 |
|---|---|
| 原始碼 | `feat/vault-preview-20261017`，從 P3 Draft PR #4 上建立，保持獨立 Draft |
| Vercel | `naosledge` / `prj_JEXZkiab0njUM7VWFhDO0NhL0GtH`，Hobby |
| Vercel target | **Preview only**，`VERCEL_ENV=preview`；嚴禁 Production target |
| SSO | 專案必須保留 `Vercel Authentication`，不能改成公開訪問 |
| Neon | `Naosledge` / `bitter-silence-36632892`，Production `br-aged-sound-b43h5r2c`；僅使用已啟用的 Auth/Data API |
| Neon Auth | 已核對的 `ep-purple-recipe-b43kznn2` `neonauth` |
| Neon Data API | 相同的 `ep-purple-recipe-b43kznn2` `apirest` |
| DB schema | 不新增、不重跑 Migration、不改授權；使用既有 `knowledge_notes`、`knowledge_links`、RLS |
| 允許路由 | `/login`、`/vault`、`/vault/new`、`/vault/graph`、`/vault/<UUID>` |
| 禁止路由 | 公開首頁、文章、Studio、管理員設定、公開草稿、寄送密碼信、Owner Activation |
| 寫入限制 | 僅 Owner 親自在受保護頁面操作私人筆記 CRUD，Agent 不建立／刪除 Production 私人資料 |
| 自動部署 | `vercel.json` 關閉此分支 Git 自動部署；必要時由 Owner 授權的單次 Preview Build |

本 Preview 的 `NAOSLEDGE_VAULT_PREVIEW_ENABLED=1`、`NAOSLEDGE_BACKEND=neon`、`NEXT_PUBLIC_NAOSLEDGE_BACKEND=neon`、`NAOSLEDGE_NEON_BRANCH_ID`、`NEON_AUTH_BASE_URL`、`NEON_DATA_API_URL`、`NEON_AUTH_COOKIE_SECRET` **只能**設定於 Vercel `target=preview` + `gitBranch=feat/vault-preview-20261017`。Secret 必須新生、加密且只保留 Vercel 服務端，不進入 Git、CI、PR、聊天、瀏覽器或日誌。Production 和既有 PR #1/#3 branch env 不變。

網域只認 Vercel 官方 `VERCEL_BRANCH_URL`、專案 ID 和精確 Git ref。實際 Preview HTTPS Alias 必須先從成功部署的 Vercel 資料查證，才可加入 Neon Production Auth Trusted Domains；禁止推測網域、萬用字元、localhost、自訂網域或重啟註冊。若設定錯誤，Server Middleware 和 Neon 用戶端全數 fail-closed。

## 部署與安全驗收步驟

1. 檢查本機單元測試、TypeScript、Next.js Build、舊網站合成 Chrome 回歸；所有測試不可呼叫 Production Auth/Data API。
2. 推送獨立 Draft PR；保留 P0–P3 未合併、CI Draft 跳過且 Vercel 禁用自動部署。
3. 唯讀查核 Vercel 專案 SSO 已開啟、Neon Auth/Data API 的精確 branch，以及正式管理員已存在。建立 Preview branch-scoped env（只限 Preview）。
4. 僅對本次審核 SHA 建立 **一次** Preview Build；確認 Deployment metadata 的專案、branch、commit、target、READY、精確 Alias 及外部未登入會遇到 Vercel SSO 保護。
5. 確認相同 Alias 的精確 HTTPS Origin 才加入 Neon Production Auth Trusted Domains；再次唯讀核對未開放 localhost/公開註冊、RLS 保持有效。
6. Owner 本人以 Vercel SSO 進入 Preview，以既有正式站長帳號登入；不把密碼、Token、Cookie、驗證碼交給 Agent。只建立／修改／刪除 **Owner 自選的私人測試筆記**，檢查 `[[連結]]`、Backlinks、搜尋、知識圖譜與 iPhone Safari。
7. Agent 僅核對不敏感的部署、路由、防護及資料庫計數；不得讀取私人 Markdown 原文或個資，也不得以 Owner 身分代為寫入／刪除。
8. 驗收後撤銷臨時 Trusted Domain、停用 Preview 啟用旗標並保留獨立 PR 供後續合併審查；不在本次操作合併 `main` 或公開發布。

## 失敗時停止

Vercel 建立 Preview 若因權限 403 被拒，優先保留所有受控設定並停止操作；可由 Owner 在專案 Dashboard 手動執行**此專案 Preview-only** 部署，不能用 Production deploy 或解除 SSO 取代。

CI Skipped 是草稿的預期結果，不能把 Skipped 當作通過；僅本機測試通過才表示原始碼可進下一關。
