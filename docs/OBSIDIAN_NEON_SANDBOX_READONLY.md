# Obsidian → Neon 整合 Sandbox：唯讀驗證介面

更新：2026-10-19。這是連上真實 Neon 前的**安全隔離驗證**，不代表已完成站長身分登入、完整遠端內容讀取、上傳／下載或正式雙向同步。

## 固定安全邊界

- 只接受既有 Naosledge 專案的 **Neon 整合 Sandbox** 分支 `br-quiet-sunset-b4xx4pnx`；資料 API 固定為這個 Sandbox 專用端點。禁止傳入使用者任意網址，禁止 Production 分支 `br-aged-sound-b43h5r2c`。
- `lib/obsidian-neon-sandbox-readonly.ts` 只有 **GET `knowledge_notes`** 的入口。執行時必須由呼叫者提供符合格式的**隔離測試站長 JWT**，並由 Neon Data API 驗證，配合原本的 RLS；不得使用 Neon SQL-owner 權限、Production 帳號、service role 或把憑證存 Git／日誌。
- 遠端讀取的必要欄位是 `id`、`slug`、`title`、`summary`、`content_md`、`category`、`tags`、`learned_on`、`updated_at`。程式只回傳由可攜式 Obsidian `.md` 格式計算的 SHA-256 與更新時間衍生的修訂指紋，**不回傳 Markdown 正文或 Owner ID**。本機和遠端的 SHA 才能作相同格式的比較。
- 最多讀取 20 篇、回應限制 5MB、單篇合成後的 Markdown 限制 250KB。若 RLS 無權限、JWT 無效、回應 HTML、重導向、超限、資料欄位不合法或結果不完整，**拒絕繼續**，不會把「查詢失敗」誤判成遠端全部刪除。
- 此模組沒有任何 `POST`、`PATCH` 或 `DELETE` 方法，沒有帳號註冊、寫入、定時同步、token 持久化或付費 API 呼叫。

## 真實 Neon Sandbox 的匿名驗證（已成功）

可在 MSI 手動執行：

```powershell
npm run verify:obsidian:neon:sandbox:anonymous
```

這個指令使用**真實 Sandbox Auth 的匿名 JWT**，逐一對私人 `knowledge_notes`、`knowledge_links`、`knowledge_publication_sources` 發送帶有 token 的 GET（`limit=1`），要求三張表都拒絕匿名存取。JWT 只在執行程序的記憶體中使用，不輸出 JWT、響應內容或其他私人資料。

2026-10-19 MSI 實際執行結果：**`NEON_SANDBOX_ANONYMOUS_RLS_PASS`，3／3 張表拒絕匿名讀取；0 次寫入**。這只能證明匿名使用者看不到表格，不能替代站長角色成功存取、內容同步或刪除／回滾測試。

## 2026-10-19 Owner 核准後的驗收更新

Owner 已正式核准只在整合 Sandbox 建立合成站長／一般使用者、測試筆記 CRUD／衝突與清理；**上述真實 Owner-JWT 測試已完成且全部成功**。包括非站長拒絕寫入、不同身分 RLS 隔離、筆記及 Wikilink CRUD、Obsidian 格式 SHA-256、帶 `updated_at` 條件的過期更新拒絕、雙方修改衝突判定、刪除合成筆記／連結，以及精確清理合成帳號／授權。詳見 [Neon Sandbox 真實合成站長 E2E 紀錄](OBSIDIAN_NEON_SANDBOX_OWNER_E2E.md)。

清理後 Sandbox 回復 **0 篇私人筆記、0 筆站長授權、0 篇文章、10 項 RLS 政策**；兩位當次合成 Auth 使用者及對應帳號均已確認不存在。**未在 Production 進行任何 CRUD**，此結果也不代表正式 Vault 已雙向同步。

實際的 Obsidian Vault 已在 MSI GUI 註冊、目前 0 篇 Markdown。除原有的單獨唯讀 Vault 指紋檢查外，這個 Neon Sandbox 模組**不會**讀取或修改實際 Vault。

### 離線驗證

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/obsidian-neon-sandbox-readonly.test.mjs tests/obsidian-sandbox-anonymous-access.test.mjs
npm run test:unit
npm run typecheck
npm run build
npm run test:release:closed:local
```

這兩組新增測試涵蓋固定 Sandbox host、JWT、RLS 拒絕、錯誤不洩漏、SQL 結果完整性、XML/HTML 不接受、不完整集合拒絕和與 Obsidian 匯出一致的指紋。合成測試使用虛構 JWT／fetch，不會連 Neon；**只有單獨手動的匿名驗證指令會連真實 Neon Sandbox**。
