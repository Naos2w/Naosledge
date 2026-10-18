# Naosledge 上線後唯讀監控（手動執行）

更新：2026-10-18。

**雲端驗收已完成：**Owner 於 2026-10-18 透過有權限的 GitHub 介面手動執行 [Run #39117955295](https://github.com/Naos2w/Naosledge/actions/runs/39117955295)，`workflow_dispatch` 與 `anonymous-production-check` 均為 `completed/success`。此成功只表示當次匿名 HTTP／SEO／權限外觀檢查通過，**不**表示已完成登入後文章發布或私人筆記操作測試。監控仍僅支援手動執行，沒有建立週期排程。

## 已完成

- GitHub Actions 的 `checkout`、`setup-node` 均升級到 Node.js 24 相容版本，並鎖定經 Git tag 查核的 v7 完整 Commit SHA。Runner 固定使用 `ubuntu-24.04`，避免 `ubuntu-latest` 在 2026-10-19 起遷移 Ubuntu 26 時影響現有 CI。
- `scripts/live-readonly-health.mjs`：固定 14 項**無憑證、唯讀 GET** 檢查。使用 `redirect: "manual"` 防止自動追進登入或 SSO；僅對公開首頁、robots、sitemap 讀取必要的文字內容。不讀取私人筆記、JWT、Cookie、Auth 會話或任何管理 API。
- `.github/workflows/live-health.yml`：只支援手動 `workflow_dispatch`，只允許 `main`，不加 `schedule`、外部排程或付費監控，最長 3 分鐘、不授予寫入權限、不上傳附件、關閉持續部署功能。

## 如何執行

在 GitHub 專案 `Naos2w/Naosledge`：**Actions → Naosledge Live Health (Manual) → Run workflow → main**。

已授權且 GitHub CLI 已登入時，也可用：

```powershell
gh workflow run live-health.yml --repo Naos2w/Naosledge --ref main
gh run list --repo Naos2w/Naosledge --workflow live-health.yml --limit 3
```

本機可執行：

```powershell
npm run verify:health:manual
```

完成會印出各項 `PASS` 或 `FAIL`、HTTP 數字以及總計。失敗時 GitHub Actions 顯示失敗，方便決定要不要人工調查。**不提供持續通知，不會定期主動執行。**

## 14 項檢查範圍

1. 正式短網址首頁 HTTP 200，確認 HTML 的 canonical 是短網址，且沒有 `noindex`。
2. 關於頁 HTTP 200。
3. 登入頁 HTTP 200 且 `noindex`、`no-store`。
4. Studio、Vault、Knowledge Graph 未登入時各為 307 至 `/login`，每項保留 `no-store`／`noindex`。
5. Sitemap HTTP 200，只列公開網址、不含私人路由。
6. Robots HTTP 200，禁止索引 Vault 與 Studio，並公告正式 Sitemap。
7. 不存在的公開文章 HTTP 404。
8. 舊長網址的首頁、帶查詢參數的 `/about`、登入、Vault 各自回傳 308，導向短網址同一路徑或參數。
9. 私人驗收 Preview HTTP 302 至 Vercel SSO，保留 `noindex`。

## 監控的限制與下一步

- HTTP 匿名檢查**無法**證明真人登入、JWT、RLS、文章發布／下架、私人筆記增刪、真正 Obsidian 自動同步或 P4 AI 功能正常。這些需要受保護的人員操作或授權過的隔離測試。
- 不代替 Vercel Runtime Error logs；此前 Vercel Runtime Errors 查詢曾回傳 403，不能宣稱已完成錯誤日誌掃描。
- 只檢查**固定 HTTPS 網域**，不允許外部傳入任意 URL，不會讀寫資料庫，也不會把 HTML、Cookie 或 SSO nonce 印到 GitHub logs。
- 目前對 Actions 額度採保守策略：人工執行一次使用一個輕量 Linux Runner Job。要改成定期追蹤／異常通知，須先明確定義頻率與預算，並由 Owner 另行授權；不要以頻繁 Cron 補償對系統真實健康度的不確定。
- 生產版本的 `NAOSLEDGE_PRODUCTION_RELEASE_SHA` 仍釘死實際部署 Commit。**本工作只改 CI、腳本與文件，不需立即替換既有已驗證的 Vercel Production 網站**。若後續有應用程式改動，要按現有受控手動發布流程更新精確 SHA。
