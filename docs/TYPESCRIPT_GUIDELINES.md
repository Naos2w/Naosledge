# Naosledge — TypeScript-first 工程規範

2026-10-18 基準：以 `git ls-files` 檢查，專案追蹤 `44` 個 `.ts`、`33` 個 `.tsx`、`39` 個 `.mjs`，沒有 `.js` 或 `.jsx`。這是**檔案數**，不是程式碼行數或真正的語言佔比。

## 為什麼不是 100% TypeScript？

- **正式網站與核心商業邏輯**本來就使用 `.ts`／`.tsx`：Next.js App Router、Server Actions、React UI、Neon Auth 封裝、權限判定、私人筆記搜尋、Obsidian 同步安全邏輯。
- **測試與維護腳本**主要使用 `.mjs`：Node.js ESM 可以透過原生 `node --test tests/*.test.mjs`、`node scripts/*.mjs` 直接執行，並與 Next.js／TypeScript 編譯分離。這個決定主要為了避免額外的測試編譯與打包步驟，**不是因為 TypeScript 無法寫測試**。
- Node.js 24 的內建 TypeScript type stripping 已可以直接執行可抹除的型別語法，但它**不等於 `tsc` 型別檢查**，不會載入 `tsconfig.json`、不會解析自訂 `paths` 映射、不支援所有需轉譯的 TS 語法。跨檔案型別檢查仍要執行 `npm run typecheck`。
- 部分舊的直接執行測試仍依賴專案 `node >=20.9` 相容性；一次更換全部測試／腳本的副檔名可能導致舊 Node 版本、E2E Fixture、CI 路徑及相對 import 規則失效，不能只改檔名。

## 後續規範

1. **新網站、後端、共用邏輯及可測試的業務規則：優先使用 TypeScript。** 有 React JSX 的才使用 TSX。
2. **新的獨立 Node.js 工具**如沒有必要使用外部編譯，優先使用 Node.js 24 可直接執行的 `.ts`。例如 `scripts/obsidian-msi-preflight.ts`；使用 TypeScript 型別來約束純函式的輸入／輸出。
3. **既有 `.mjs` 保留運作**，如未來需要逐步統一，須以一個小 PR 為單位搬遷：同時更新 import、`package.json`、CI、Test Runner、型別檢查與文件，必須全套回歸通過才能合併。
4. **禁止為了 100% TypeScript** 一次性搬遷 39 個現有 Node 腳本／測試，也不應增加非必要 runtime dependencies、Vercel build 次數或改動正式私人資料庫。
5. PR 驗證至少 `npm run test:unit`、`npm run typecheck`、`npm run build`、`npm run test:release:closed:local`。會與實際檔案／瀏覽器互動的功能要再執行對應本機 Chrome 回歸。

參考 Node.js 官方 [TypeScript 文件](https://nodejs.org/api/typescript.html) 與 [MSI Obsidian 安裝前檢查](OBSIDIAN_MSI_SETUP.md)。
