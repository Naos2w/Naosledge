# Naosledge Second Brain — P1 + P2 實作／驗收規格

更新：2026-10-17。這份文件屬於獨立開發分支 `feat/private-knowledge-vault-20261017`，建基於原 Draft PR #1。**Owner 已明確核准並在 Naosledge Neon Sandbox 套用 `002`；真實 Better Auth／JWT／Data API／RLS／Chrome E2E 全部通過，合成帳號與資料已清理。Neon Production 已於 2026-10-17 另行獲准套用 `002` 並完成資料庫後驗、未合併 PR、未部署新版本至 Vercel，也沒有使用正式站長帳號。**

## 決定的產品定位

**Naosledge 是 Private-first 第二大腦，公開網站是經審核後的獨立發佈層。** 兩套資料來源不相混：既有 `public.posts` 為公開文章/未公開草稿編輯區；新增 `public.knowledge_notes` 才是預設私人的原始知識庫。先進行 P1+P2（獨立 Vault、索引與知識關聯）；真正圖譜互動與 AI 仍在後續 P3/P4，不宣稱已完成。

### Privacy/權限矩陣

| 角色 | 私人知識 | 私人連結與索引 | 公開草稿 | 已發布文章 |
|---|---|---|---|---|
| 未登入／匿名 | 無表格權限 | 無表格／RPC 權限 | 不可讀 | 可讀 |
| 已登入非站長 | RLS 拒絕 | RLS 拒絕 | 不可寫／不可讀 | 可讀 |
| 站長 A | 僅自己持有 | 僅自己的連結／映射 | 可自行建立草稿 | 依既有 posts 管理規則 |
| 站長 B | **無法查看 A 的私人內容** | 無法查看 A 的連結 | 無法由 A 的知識建立草稿 | 依既有 posts 管理規則 |

### Migration（已核准套用 Sandbox，Production 002 已完成）

- 檔案：`neon/migrations/002_private_knowledge_vault.sql`，必須先有既有 `001_initial_blog.sql`、Better Auth 與 Data API 角色。
- `knowledge_notes`：隸屬 owner 的私人筆記，`id` 與每位 owner 內唯一的 slug、Title、Summary、Markdown、Category/Tags、日期。所有寫入、讀取由 Neon JWT 經受控 `public.vault_current_user_id()` 解析，並配合 `blog_admins` 與 RLS 強制限制。
- `knowledge_links`：`(owner_id,source_note_id,target_key)` 主鍵，以文本鍵儲存 `[[slug]]`、`[[標題]]` 的**有方向連結**；無目標時保留未解析鍵，未來補建筆記會自動符合。刪除來源筆記會由 FK cascade 刪除該來源的連結。
- `knowledge_publication_sources`：僅站長本人可見的私人原稿與公開文章副本對應表，不能由匿名透過 Data API 讀取。
- `save_knowledge_note` RPC：一個 PostgreSQL 交易內更新筆記並重建 outgoing links，避免筆記與連結一半成功。函式為 `SECURITY INVOKER`，不能繞過資料表 RLS。
- `create_knowledge_public_draft` RPC：**只建立既有 `posts` 中的 status=draft 副本**，不可直接公開。來源仍是私人筆記；資料庫寫入及 private mapping 在同一個交易完成。
- `search_knowledge_notes` RPC：以 `GIN(search_document)` 搜尋英文/空白分詞，並用字串 substring 補足中文及摘要／標籤；**中文子字串尚未有倒排索引**，大量資料時須另評估 `pg_trgm` 或 tokenizer，不應宣稱是完整索引的中文全文搜尋。
- 所有新表預設不授權匿名，不向公開文章頁傳遞私有 ID／來源映射；函式權限也撤除對 PUBLIC/anonymous 的預設 EXECUTE。

**Production 已在 2026-10-17 獲另一項核准並成功套用 002，禁止在既有 Production 分支重複執行**。本階段只完成資料庫結構與權限後驗；備份／回復、正式站長、Auth 安全政策、部署與正式網站驗收仍須另行確認。嚴禁操作其他既有 Supabase/Neon 專案。

## UI／功能

- `/vault`：通過 Neon 管理員身份與 RLS 檢查的私人索引、分類標籤、日期與搜尋；每次最多回傳 100 項，避免 Free 長列表負荷。
- `/vault/new`、`/vault/[id]`：私人 Markdown 編輯器；編輯後明確按「儲存私人筆記」才會將內容及關聯寫入雲端，**私人筆記不預設放進 localStorage**。
- WikiLinks：`[[slug]]`、`[[完整標題]]`、`[[slug|顯示名稱]]`。解析 Markdown AST 的文字節點，忽略 fenced code、inline code、已有 Markdown links、圖片與 raw HTML；標題重複有歧義時不自動解析，優先採用穩定 slug。
- 編輯器的「插入 [[連結]]」下拉選單能參考 owner 目前最多 500 篇的標題索引。詳情頁顯示 Outgoing、Backlinks 與 Unresolved。現階段關聯視覺顯示最多 3000 筆（規劃後續分頁）；不宣稱 Graph View 已完成。
- `/studio` 在 Neon 模式新增「私人知識庫」入口，原本公開文章流程完整保留。Supabase 相容模式則不顯示 Vault 按鈕，Vault 路由直接 404。
- **選擇性發布**：私人編輯器可明確要求建立**公開文章草稿副本**，並且先確認警告；WikiLinks 複製成一般文字，未經手動檢查絕不發布。使用者在原 Studio 另行檢查／按發布；更新/刪除私人原稿不會自動更新/刪除公開副本，防止兩層內容互相影響。
- Markdown 備份：匯出 `.md`、匯入普通 Markdown 或 Naosledge 備份。類似 Obsidian Vault 的可攜文字格式，但目前仍是**手動匯入/匯出**，不是檔案夾自動同步器。
- 目前所有 `/vault` 路由加 `noindex`，沒有外部匿名 JSON API，不會把私人內容混到公開 SEO/Sitemap/JSON-LD。

## 測試與已知限制

```powershell
npm ci --include=dev --no-audit --no-fund
npm run test:unit
npm run typecheck
npm run build
npm run test:browser:local
```

`tests/knowledge-rls.test.mjs` 於**本機 PGlite 合成資料庫**串接 001+002，驗證匿名／非站長拒絕、兩站長私人資料隔離、RPC 原子寫入、英文索引、中文 substring、Backlinks 私有性及公開草稿仍為 draft。**本次另已在經授權的 Neon Sandbox 完成真正 JWT/Data API/Chrome E2E**，實體驗收結果及清理證據見下方。測試腳本不得排入 CI，不能轉用 Production。

`tests/wiki-links.test.mjs` 驗證語法、Markdown AST 跳過 code/html、slug/標題的歧義與安全路徑；`tests/vault-validation.test.mjs` 驗證長度、資料格式、連結上限、匯出為公開草稿前的非連結文字轉換。

P3 視覺 Graph、P4 Embeddings／AI 問答、真正 Obsidian 雙向同步、完整發佈版歷史、中文大規模全文倒排索引尚未實作。私人資料需要明確的備份策略，不能把瀏覽器本機備份當成永續儲存。
