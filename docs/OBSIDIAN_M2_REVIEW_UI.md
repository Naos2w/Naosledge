# NaosLedge × Obsidian M2 — 手動逐篇同步審查 UI

更新：2026-10-23。此階段只建立**可操作的審查畫面與選擇意圖**，不包含同步執行。

## 產品契約

- Obsidian 和 NaosLedge 兩邊都能編輯；預設手動觸發，逐篇確認。
- 首次同名不同、雙方同時修改 → `conflict`，**僅允許「保留兩份」或「略過」**，沒有直接上傳/下載覆寫按鈕。
- 單邊變更或缺失 → 只提供對應方向的「預定上傳／預定下載」及「略過」。缺失不推論刪除。
- M1 回報 `partial-local-coverage` 時，明確顯示未支援 Markdown 檔名及未掃描目錄數；**不能把未列入清單的內容當成同步完成或刪除對象**。
- `unchanged`、`both-removed` → 不顯示可選操作，不推論清理或刪除。
- 所有選擇只放在 React 記憶體 state：**不保存、不同步、不執行、不授權**。刷新／離頁即消失。
- 只能在已有 Neon 登入、Email 驗證、管理員授權的私人 `/vault/sync` 路由看到審查頁。**預設仍為合成示例**；僅在 Owner 明確從 MSI 匯入獨立 JSON 時，才改顯示該次唯讀差異快照（非網站即時連線）。

## 本階段實作

| 檔案 | 用途 |
| --- | --- |
| `app/vault/sync/page.tsx` | `requireVault()` 保護的私人頁，預設提供合成 M1 preview；瀏覽器可自行匯入 MSI 唯讀快照，不向伺服器上傳 |
| `components/vault-manual-sync-review.tsx` | 差異清單、版本短指紋、狀態篩選與搜尋、逐篇按鈕、審查摘要與清除 |
| `lib/obsidian-m2-review-choices.ts` | 純函式方向白名單、拒絕非法覆寫、檢查 Read-only M1 preview、統計選擇；驗證手動 JSON 快照格式及完整性 |
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

## MSI → M2 唯讀 JSON 手動交接（尚未真實驗收）

只有在 **MSI** 上持有短效、**Neon Sandbox-only Owner JWT** 時，Owner 才能自願執行下列指令。JWT 由 SecureString 轉為本進程標準輸入，**不放 argv、環境變數、Git 或聊天**。本機導出的 JSON 含**私人 slug、兩端 SHA/revision 與審查分類**，但沒有 JWT 或 Markdown 正文；請只儲存在 Owner 可控本機位置，勿公開或提交版本控制。

```powershell
$secret = Read-Host 'Short-lived SANDBOX Owner JWT' -AsSecureString
$handoff = Join-Path $env:TEMP 'naosledge-m2-private-review.json'
try {
  [System.Net.NetworkCredential]::new('', $secret).Password |
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-msi-manual-preview.ts --sandbox-m2-review-json |
    Set-Content -LiteralPath $handoff -Encoding utf8
} finally {
  Remove-Variable secret -ErrorAction SilentlyContinue
}
```

指令只允許 MSI 及這個顯式模式；JSON 會先經過既有固定 Neon Sandbox 的 `blog_admins` Owner-RLS 驗證、完整 `knowledge_notes` GET 與 M1 二次本機掃描。若出錯，不能匯入空檔並宣稱成功。登入站長私人 `/vault/sync`，用「選擇 MSI Sandbox JSON 檔案」**在瀏覽器本機**讀入；程式不 POST、不同步、不保存選擇，無 Markdown 傳輸。JSON 內容只是某一時點的快照，任何未來寫入仍必須重新驗證雙邊版本並由本人另行逐篇核准。使用完畢請在本機安全清理該暫存 JSON，不得誤認為備份或 Baseline。

**尚缺**：真人私人帳號在受控 Preview 使用 UI 的驗收、真正 MSI+Neon Sandbox Owner-RLS 唯讀 M1 端到端、歷史 Baseline、內容差異比較、真實寫入操作、正式部署。M2 即使合併，以上全部仍須另行核准。M3/M4 需要重讀兩端版本，逐篇取得本人當次授權，確保不覆寫／不自動刪除。

注意：現在只顯示 SHA 前 10 字元，並不提供 Markdown 正文比較。合成示例中遠端 RLS 旗標只是測試形狀，**沒有做真正的 Owner 身分／Neon 連線**；手動匯入 JSON 也只是**已由 MSI 端生成的快照**，不能證明網站端剛完成 RLS 驗證，且可能已過期。不得用本次 UI 當作正式同步已啟用的證明。
