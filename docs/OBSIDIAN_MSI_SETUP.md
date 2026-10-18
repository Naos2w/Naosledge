# MSI 電腦：Obsidian 安裝與 Naosledge 同步準備

更新：2026-10-18。Owner 已選擇 **MSI（Windows 11）** 為未來的 Obsidian 同步電腦，但尚未安裝 Obsidian、尚未選擇 Vault 的實際資料夾。這份文件只說明準備流程，**不代表允許掃描本機檔案、安裝常駐程式、寫入私人筆記、刪除檔案或啟動自動同步**。

## 已驗證（MSI）

- 電腦名稱：`MSI`；Windows 11；`winget` 可使用。
- Windows Package Manager 查詢到套件識別碼 `Obsidian.Obsidian`。本次查到可用套件版本 1.14.4，安裝時以使用者確認的實際來源版本為準。
- 常見的 Obsidian 程式執行檔位置未發現安裝；此檢查不能排除非標準安裝或 Microsoft Store 類型。
- 專案新增 **TypeScript** 唯讀前置檢查：在 MSI／Node.js 24 執行 `npm run verify:obsidian:msi`。只檢查四個常見程式安裝位置；不開啟本機筆記檔案、不搜尋其他資料夾、不裝程式。

## 安裝（需要 Owner 確認後執行）

在 **MSI PowerShell** 中：

```powershell
winget install --id Obsidian.Obsidian --exact --source winget --accept-source-agreements --accept-package-agreements
```

或使用官方 [Obsidian 下載頁](https://obsidian.md/download) 自行安裝。

**注意：安裝應用程式會修改 MSI 的軟體清單。這份 PR 沒有執行安裝；待 Owner 明確同意才使用連接電腦的操作能力安裝。**

安裝完成後，在 Obsidian 介面選擇「Create new vault」，設定容易識別的名稱及**你自己選擇的本機資料夾**。先建立測試用途的空白 Vault，避免直接接管其他筆記。不預設安裝位置等於 Vault 位置，也不推測你的 iCloud／OneDrive／Syncthing 路徑。

## 第一次連接 Naosledge（安全順序）

1. Owner 告訴專案實際 Vault 資料夾的完整路徑，例如 `C:\Users\<username>\Documents\Obsidian\<vault>`（此處只是格式示例，**不是已授權位置**）。
2. 先用合成 Markdown，在隔離測試資料夾執行唯讀版本指紋比對，檢查 slug、SHA-256、檔案修改、衝突、刪除及資料夾更名情境。
3. 對照 Naosledge [Obsidian 單篇手動匯入／匯出](OBSIDIAN_MARKDOWN_BRIDGE.md) 與 [同步安全預演](OBSIDIAN_SYNC_SAFETY.md)。目前的預演沒有資料夾讀取／寫入能力。
4. 若要自動雙向同步，還必須先決定刪除政策（預設絕不自動刪除）、衝突是否每次提示、同步頻率與是否需要 iPhone 一同參與。之後才能設計使用本人 Neon Auth／RLS 的真正執行器，且應先在 Sandbox 驗收。
5. 不安裝背景同步服務、不開放私人筆記到公用網站、不把密碼、Cookie 或 API Token 存進 GitHub Actions。

## 關於 TypeScript

這次新增的 MSI 前置檢查使用 `scripts/obsidian-msi-preflight.ts`，而不是新建 JavaScript 版本。Node.js 24 可以直接執行可抹除型別語法的 TypeScript，但**不會自動執行 TypeScript 型別檢查，也不會讀取 tsconfig 的路徑別名**；因此還須配合 `npm run typecheck`。既有 `.mjs` 測試／腳本可分批遷移，不應為求統一而一次破壞運作中的 CI。詳見 [TypeScript-first 工程規則](TYPESCRIPT_GUIDELINES.md)。

## 尚未完成

- Obsidian 安裝與應用程式首次開啟（需要 Owner 同意）
- Owner 選定並授權的 Vault 位置
- 實際 Obsidian 資料夾的本地讀取（尚未進行）
- 真正的本地↔Neon 寫入執行器、回滾與衝突處理
- 如有需要：iPhone 參與及多裝置一致性

本階段不聲稱已完成真正的自動雙向同步。
