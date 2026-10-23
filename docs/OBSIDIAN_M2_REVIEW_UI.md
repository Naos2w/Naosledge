# NaosLedge × Obsidian M2 — 手動逐篇同步審查 UI

更新：2026-10-23。此階段只建立**可操作的審查畫面與選擇意圖**，不包含同步執行。

## 產品契約

- Obsidian 和 NaosLedge 兩邊都能編輯；預設手動觸發，逐篇確認。
- 首次同名不同、雙方同時修改 → `conflict`，**僅允許「保留兩份」或「略過」**，沒有直接上傳/下載覆寫按鈕。
- 單邊變更或缺失 → 只提供對應方向的「預定上傳／預定下載」及「略過」。缺失不推論刪除。
- `unchanged`、`both-removed` → 不顯示可選操作，不推論清理或刪除。
- 所有選擇只放在 React 記憶體 state：**不保存、不同步、不執行、不授權**。刷新／離頁即消失。
- 只能在已有 Neon 登入、Email 驗證、管理員授權的私人 `/vault/sync` 路由看到示例。內容為**合成固定資料**，而非真實私人筆記或真正的差異預覽結果。

## 本階段實作

| 檔案 | 用途 |
| --- | --- |
| `app/vault/sync/page.tsx` | `requireVault()` 保護的私人頁，只建立合成 M1 preview |
| `components/vault-manual-sync-review.tsx` | 差異清單、版本短指紋、狀態篩選與搜尋、逐篇按鈕、審查摘要與清除 |
| `lib/obsidian-m2-review-choices.ts` | 純函式方向白名單、拒絕非法覆寫、檢查 Read-only M1 preview、統計選擇 |
| `lib/obsidian-m2-synthetic-fixture.ts` | 使用 **真實 M1 判斷器**，但本機/遠端全是合成固定指紋、沒有 Reader／網路 |
| `app/vault/vault-sync.css` | 沿用既有深色／淺色 Liquid Glass Tokens 的審查表單版面 |
| `tests/obsidian-m2-review-choices.test.mjs` | 白名單與 fail-closed、防刪、缺失／雙邊衝突、無副作用 |
| `scripts/smoke-obsidian-m2-ui.mjs` | MSI Chrome：只啟動 temporary local Next fixture、合成資料、鍵盤、四尺寸與截圖；不連線 Neon |

站長私人筆記索引 `/vault` 已加入「同步審查預演」入口，但**正式站本次未部署**。M2 不是一鍵同步，也不產生真正的權限批准、Token、執行器命令或同步 Baseline。

## 驗收與限制

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/obsidian-m2-review-choices.test.mjs
npm run test:browser:obsidian:m2:local
npm run test:unit
npm run typecheck
npm run build
npm run test:release:closed:local
```

Chrome 瀏覽器測試檢查 375、768、1024、1440px 不溢出、操作至少 44px、Tab/Enter 選擇、衝突只可保留兩份或略過、逐篇方向選擇、搜尋和清除、無外部 HTTP 請求。截圖僅儲存 MSI 作業系統暫存目錄，不加入 GitHub。

**尚缺**：真人私人帳號在受控 Preview 使用 UI 的驗收、真正 MSI+Neon Sandbox Owner-RLS 唯讀 M1 端到端、獨立 QA、歷史 Baseline、內容差異比較、真實寫入操作、正式部署。M2 即使合併，以上全部仍須另行核准。M3/M4 需要重讀兩端版本，逐篇取得本人當次授權，確保不覆寫／不自動刪除。

注意：現在只顯示 SHA 前 10 字元，並不提供 Markdown 正文比較。合成示例中遠端 RLS 旗標只是測試形狀，**沒有做真正的 Owner 身分／Neon 連線**；不得用本次 UI 當作正式同步已啟用的證明。
