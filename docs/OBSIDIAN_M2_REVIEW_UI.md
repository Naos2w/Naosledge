# NaosLedge × Obsidian M2 — 手動逐篇同步審查 UI

更新：2026-10-26。M1/M2 已整合 `main`；本輪讓正式路由預設不顯示合成資料，並完成 MSI 檔案交接的本機瀏覽器回歸。真正 Sandbox Owner-JWT 遠端讀取仍未驗收；本階段不包含同步執行。

## 產品契約

- Obsidian 和 NaosLedge 兩邊都能編輯；預設手動觸發，逐篇確認。
- 首次同名不同、雙方同時修改 → `conflict`，**僅允許「保留兩份」或「略過」**，沒有直接上傳/下載覆寫按鈕。
- 單邊變更或缺失 → 只提供對應方向的「預定上傳／預定下載」及「略過」。缺失不推論刪除。
- M1 回報 `partial-local-coverage` 時，明確顯示未支援 Markdown 檔名及未掃描目錄數；**不能把未列入清單的內容當成同步完成或刪除對象**。
- `unchanged`、`both-removed` → 不顯示可選操作，不推論清理或刪除。
- 所有選擇只放在 React 記憶體 state：**不保存、不同步、不執行、不授權**。刷新／離頁即消失。
- 只能在已有 Neon 登入、Email 驗證、管理員授權的私人 `/vault/sync` 路由看到審查頁。**預設為空白待匯入狀態**；只有 Owner 明確選取 MSI JSON 時，才顯示該次唯讀差異快照（非網站即時連線）。合成示例只在測試 Fixture 使用。

## 本階段實作

| 檔案 | 用途 |
| --- | --- |
| `app/vault/sync/page.tsx` | `requireVault()` 保護的私人頁，預設不載入任何筆記；瀏覽器可自行匯入 MSI 唯讀快照，不向伺服器上傳 |
| `components/vault-manual-sync-review.tsx` | 差異清單、版本短指紋、狀態篩選與搜尋、逐篇按鈕、審查摘要與清除 |
| `lib/obsidian-m2-review-choices.ts` | 純函式方向白名單、拒絕非法覆寫、檢查 Read-only M1 preview、統計選擇；驗證手動 JSON 快照格式及完整性 |
| `lib/obsidian-m2-synthetic-fixture.ts` | **僅用於離線測試**：使用 M1 判斷器與合成指紋；不供正式路由使用 |
| `app/vault/vault-sync.css` | 沿用既有深色／淺色 Liquid Glass Tokens 的審查表單版面 |
| `tests/obsidian-m2-review-choices.test.mjs` | 白名單與 fail-closed、防刪、缺失／雙邊衝突、無副作用 |
| `scripts/smoke-obsidian-m2-ui.mjs` | MSI Chrome：驗證正式頁面空白起始狀態、使用 M1 實際檔案輸出函式產生並匯入 JSON、鍵盤、四尺寸及合成資料衝突；不連線 Neon |

站長私人筆記索引 `/vault` 已改為「同步審查（唯讀）」入口，進入後不會顯示假筆記。**正式站本次未部署**。M2 不是一鍵同步，也不產生真正的權限批准、Token、執行器命令或同步 Baseline。

## 驗收與限制

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/obsidian-m2-review-choices.test.mjs
npm run test:browser:obsidian:m2:local
npm run test:unit
npm run typecheck
npm run build
npm run test:release:closed:local
```

Chrome 瀏覽器測試檢查 375、768、1024、1440px 不溢出、操作至少 44px、Tab/Enter 選擇、衝突只可保留兩份或略過、逐篇方向選擇、搜尋和清除；另以 OS 暫存 JSON 檔完成匯出→匯入→清除路徑。沒有外部 HTTP 請求，截圖只儲存 MSI 作業系統暫存目錄，不加入 GitHub。

## MSI → M2 唯讀 JSON 手動交接（程式完成；真正 Owner JWT 驗收待完成）

PR #28（瀏覽器本機匯入）與 #31（MSI `--sandbox-m2-readonly-handoff` 匯出）均已合併。兩端交接已在 MSI Chrome 以合成資料實際建立檔案並完成本機匯入驗證。**尚未取得 Sandbox-only Owner JWT 完成真正 Owner-RLS GET 與真人私人資料驗收**；不得使用舊的 `--sandbox-m2-review-json`／管線 `Set-Content` 輸出私人資料。

只有在 **MSI** 上持有短效、**Neon Sandbox-only Owner JWT** 時，Owner 才能自願執行下列指令。JWT 由 SecureString 轉為本進程標準輸入，**不放 argv、環境變數、Git 或聊天**。PR #31 會在作業系統使用者暫存目錄**排他建立隨機檔名**，終端只顯示檔案路徑；JSON 含私人 slug、兩端 SHA/revision 與審查分類，**不含 JWT 或 Markdown 正文**。

```powershell
$secret = Read-Host 'Short-lived SANDBOX Owner JWT' -AsSecureString
try {
  [System.Net.NetworkCredential]::new('', $secret).Password |
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-msi-manual-preview.ts --sandbox-m2-readonly-handoff
} finally {
  Remove-Variable secret -ErrorAction SilentlyContinue
}
```

匯出前仍需固定 Neon Sandbox 的 `blog_admins` Owner-RLS 驗證、完整 `knowledge_notes` GET 與 M1 二次本機掃描；任何錯誤都不得視為空清單成功。使用回報的檔案路徑，在已授權的私人 `/vault/sync` 用「選擇 MSI Sandbox JSON 檔案」於**瀏覽器本機**讀入；不會 POST、執行同步或保存審查選擇。JSON 只是某一時間點的差異快照，未來任何寫入仍須重新驗證兩邊版本並由本人逐篇核准。匯入後請手動安全清理暫存 JSON，不得把它當成備份或 Baseline。

**尚缺**：真人私人帳號在受控 Preview 使用 UI 的驗收、真正 MSI+Neon Sandbox Owner-RLS 唯讀 M1 端到端、歷史 Baseline、內容差異比較、真實寫入操作、正式部署。M2 即使合併，以上全部仍須另行核准。M3/M4 需要重讀兩端版本，逐篇取得本人當次授權，確保不覆寫／不自動刪除。

注意：現在只顯示 SHA 前 10 字元，並不提供 Markdown 正文比較。合成示例中遠端 RLS 旗標只是測試形狀，**沒有做真正的 Owner 身分／Neon 連線**；手動匯入 JSON 也只是**已由 MSI 端生成的快照**，不能證明網站端剛完成 RLS 驗證，且可能已過期。不得用本次 UI 當作正式同步已啟用的證明。
