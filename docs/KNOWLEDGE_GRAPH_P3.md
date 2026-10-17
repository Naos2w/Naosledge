# Naosledge — Private Knowledge Atlas (P3)

更新：2026-10-17。開發分支 `feat/knowledge-graph-p3-20261017`，依賴 [Owner Activation PR #3](https://github.com/Naos2w/Naosledge/pull/3) 和 P1/P2 的 [Private Vault PR #2](https://github.com/Naos2w/Naosledge/pull/2)。

**本階段只新增程式與本機測試；不合併 PR、不變更 Neon Schema／Production Auth、不新增任何正式私人知識、不觸發 Vercel 自動部署。** 本 P3 的圖譜不是 AI 語意向量搜尋或自動關聯推論，後者屬 P4。

## 功能與介面

- **`/vault/graph`**：私人站長專屬的互動式知識網絡圖，沿用 Naosledge 深色／玻璃／閱讀導向的視覺。入口新增在私人筆記索引 `/vault`。
- **概念節點與有向關聯**：一篇私人筆記一個節點，`knowledge_links` 的 `[[slug]]`／`[[標題]]` 解析為連線；目標不存在、超出載入範圍或標題歧義時不臆造關係。自己連自己不繪製，重複引用只合併成一條有向連線。
- **全覽與局部兩層關聯**：概念按分類形成穩定的星座式佈局；點選節點可切換中心、直接鄰居與第二層鄰居。SVG 在不同畫面大小重新置中，觸控橫向滑動、放大縮小；不依賴永不停歇的物理動畫、WebGL、付費圖形服務或第三方帳號。
- **搜尋、分類、已連結篩選**：可查筆記標題、slug、分類及標籤。搜尋只篩選**本次已授權、已載入**的私人節點，不是全資料庫的全文搜尋；全文搜尋請返回 `/vault`。
- **知識檢視器**：顯示已選節點、直接鄰居、分類和私人筆記跳轉，且可以從單篇編輯器直接進入 `/vault/graph?focus=<UUID>` 局部網絡。
- **無障礙替代**：每個 SVG 節點與鍵盤 Enter／Space 可用；同時提供明確的筆記清單、可聚焦按鈕、直接開啟筆記連結。Graph 區域可被鍵盤聚焦後橫向捲動；`prefers-reduced-motion` 下無持續動畫。
- **響應式驗收範圍**：375px、768px、1024px、1440px；手機 SVG 在**圖譜容器內**橫向捲動，整頁不水平溢出；初次進入和點選節點時自動將目標置中，也會隨視窗改變重新置中。
- **空白／失敗狀態**：尚無私人筆記時提供新增入口；Neon 資料讀取失敗時不顯示私有後端錯誤或秘密。未解析的連結只顯示**計數**，不是其他帳號的標題。

## 私密資料與效能規則

1. Server Component 的 `requireVault()` 先要求 Neon backend、正式 Email 已驗證的站長登入與 RLS。圖譜也保持 `dynamic=force-dynamic` 與 `noindex`。
2. `loadVaultGraph()` 將筆記與所有連結批次查詢都綁定 **JWT/RLS + `owner_id`**。只查詢 `id`、`slug`、`title`、`category`、`tags` 與私人參照的 `source_note_id`／`target_key`；連結讀取時用於全域新舊排序的 `created_at` 僅留在伺服器。**絕不將 `content_md`、`summary`、`owner_id`、Auth Token／Password、參照時間或 `knowledge_publication_sources` 傳到圖譜元件**。
3. 後端最多取**最近 180 篇**私人筆記、**2,400 條**這些筆記的私人參照（使用 `+1` 判定截斷）；單次 SVG 圖譜最多顯示 100 個節點，篩選後可用文字清單瀏覽已載入者。限制截斷要在畫面上說明，不得把「看不到」誤認為「沒有關聯」。
4. 可視化由 `lib/knowledge-graph.ts` 的純函式在記憶體中推導，穩定 Hash + 有限圈層，無長時間輪詢、外部資料呼叫、付費 Graph Database 或 AI API；以免費 Hobby 預算為優先。
5. 私人 Vault 的所有路由都加上 `Cache-Control: private, no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex, nofollow, noarchive`。公開文章完全不渲染私人 Graph。Supabase 相容模式的 `/vault/graph` 一律 404。
6. 不建立任何 SQL Migration。現有 Neon Sandbox 與 Production 的已核准 `002` 私人表結構不變；Production Admin 授權已在此前另行獲准完成，但**網站新圖譜沒有獲得 Production Deploy 的授權**。
7. 新 feature 分支在 `vercel.json` **禁用 Git 自動部署**，避免 CI/Vercel 額度浪費；PR 保持 Draft 並堆疊在既有 PR #3 之上。

## 測試

- `tests/knowledge-graph.test.mjs`：使用純合成節點、標題歧義、無效 ID、隱藏內容、超量資料，驗證解析關係、限制、決定性佈局與兩層聚焦。
- `tests/vault-graph-queries.test.mjs`：180 篇筆記的 ID 最多每批 48 個、完整 Neon PostgREST 模擬請求網址低於 3KB、所有批次維持 `owner_id` 限制，並驗證最新 2,400 條連結的全域排序、截斷與不將時間欄位傳給前端；**不呼叫任何 Neon 網路端點**。
- `scripts/smoke-knowledge-graph.mjs`：建立暫時的 Next.js 測試頁並載入**真正的 Graph React 元件及 CSS**，使用 MSI Chrome/Edge 驗證四組 viewport、SVG 滾動與自動置中、節點點擊／鍵盤、標題與標籤搜尋、分類篩選及直接筆記導航；所有資料為合成，**沒有任何 Neon Auth／Data API／Production 網路請求**，測試後移除暫時路由。
- `npm run test:unit`、`npm run typecheck`、`npm run build`、`npm run test:browser:local`、`npm run test:browser:neon-recovery:local`、`npm run test:browser:owner-activation:local` 持續保護前一階段行為。
- Screenshot 只保留在 MSI 本機 Temp 供人工審閱，不上傳 GitHub／CI；Graph 沒有真實私人筆記照片資料。

## 後續限制／設計取捨

本 P3 採「**私人筆記 → 局部關聯 → 圖譜探索**」而不是大型社群網絡可視化。尚未有知識關係類型（三元組）、語意 Embeddings、AI 自動連結、Obsidian 雙向檔案同步、線上 iPhone Safari 真實帳號驗收，也尚未有數千篇中文筆記的圖譜分頁。這些都需要後續逐步優化，不能因示範圖成功就宣稱第二大腦 AI 已完成。

下一步正式上線需要獨立審查與授權：確認 PR #1 → #2 → #3 → P3 的堆疊整合，提供站長 Private Vault 的受保護 HTTPS 驗收環境，驗證正式登入及私人 CRUD，然後才能討論 PR 合併與 Production 發布。
