# Naosledge 私人搜尋相關度排序（零 API 費用）

更新：2026-10-18。這是 P4 之前的**詞彙搜尋改善**，不是 AI 向量／語意搜尋，也不承諾能找出同義詞或問答。

## 操作與排序規則

進入 `/vault`，輸入中文或英文關鍵字，伺服器仍先呼叫既有 Neon `search_knowledge_notes` RPC；該函式使用站長 JWT、`owner_id` 與 PostgreSQL RLS 限制查詢，每次最多回傳 100 篇，且包含標題、摘要、標籤和**私人 Markdown 正文**的全文命中（但不把 Markdown 正文帶到索引畫面）。

新版只在 **RPC 已取得的結果**內重新排序，依次增加標題完全符合、標題前綴、標籤符合、slug、標題部分符合、摘要、分類和查詢詞覆蓋程度的分數。中文可直接以文字匹配，全形英數以 NFKC 正規化，英文比較不分大小寫。相同分數保留 SQL 結果的更新時間順序，不修改原始陣列。

即使只在 Markdown 正文內命中、顯示摘要沒有關鍵字的筆記，**仍完整保留**在清單中（分數可能較低），不應被純 metadata 排序誤判成查無結果。

## 隱私與額度

- 不讀取任何額外筆記、不擴大 RPC 查詢、不寫入 Neon、不建立新資料表或 index，沒有外部 AI／embedding 請求，也不產生新的計費項目。
- 排序只處理授權後的已載入 metadata；不讀取或傳遞私人 Markdown、`owner_id`、JWT 或 Neon Cookie。
- 限制：SQL 先依最近更新時間選取**最多 100 篇符合的筆記**，再在這批內重排。若有超過 100 筆命中，較舊筆記可能被截斷，並非全知識庫的全球相關度排序。
- 這不是 P4 語意搜尋。P4 若引入雲端模型，必須先獨立決定私人資料會否傳出、API 金鑰的保護、成本上限與模型授權；不能默默啟動外部服務。

## 離線驗證

- `tests/vault-search-rank.test.mjs` 覆蓋中文、全形、英文字母大小寫、混合條件、標籤／標題權重、正文-only 命中、穩定排序和不洩漏私有欄位。
- `npm run test:unit`、`npm run typecheck`、`npm run build` 和 `npm run test:browser:local` 都使用合成測試資料，不依賴或寫入 Neon Production。
