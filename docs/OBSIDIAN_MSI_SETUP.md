# MSI 電腦：Obsidian 安裝與 Naosledge 同步準備

更新：2026-10-19。Owner 已授權使用 **MSI（Windows 11）**；Obsidian **1.14.4 已由 Winget 安裝並驗證數位簽章**，核准資料夾為 **`C:\Naos\Obsidian\Naosledge`**。Owner 已在 GUI 透過「開啟資料夾作為儲存庫」完成註冊；MSI 唯讀核對 `.obsidian` 設定與全域註冊紀錄，兩者都指向該資料夾。當前只有 `.obsidian` 設定資料夾（4 個設定檔），**0 篇 Markdown 筆記**。本方案不授權背景同步、雲端寫入、刪除或任意資料夾掃描。

## 已驗證（MSI）

- 電腦名稱：`MSI`；Windows 11；`winget` 可使用。
- Windows Package Manager 套件 `Obsidian.Obsidian` **1.14.4 已安裝**，執行檔簽章為 Valid；`npm run verify:obsidian:msi` 回報找到安裝程式。
- Owner 已授權 `C:\Naos\Obsidian\Naosledge`，在資料夾原本不存在時建立；現在存在 `.obsidian` 資料夾與 4 個設定檔，Obsidian GUI **已完成 Vault 註冊**，沒有 Markdown 筆記。
- 專案新增 **TypeScript** 唯讀前置檢查：在 MSI／Node.js 24 執行 `npm run verify:obsidian:msi`。只檢查四個常見程式安裝位置；不開啟本機筆記檔案、不搜尋其他資料夾、不裝程式。

## Obsidian 已安裝（歷史操作）

在 **MSI PowerShell** 中：

```powershell
winget install --id Obsidian.Obsidian --exact --source winget --accept-source-agreements --accept-package-agreements
```

或使用官方 [Obsidian 下載頁](https://obsidian.md/download) 自行安裝。

**這項安裝已由 Owner 授權並完成**，不需再次執行 Winget。

### Obsidian GUI 已完成註冊（2026-10-19 驗收）

1. 開啟 MSI 上的 Obsidian。
2. 在管理 Vault 畫面選擇 **「開啟資料夾作為儲存庫」（Open folder as vault）**，指定 `C:\Naos\Obsidian\Naosledge`。
3. **不要**再選「建立新的儲存庫」並把此路徑當作上層資料夾，以免建立 `Naosledge\Naosledge` 巢狀位置。
4. Obsidian 應自行於既有資料夾建立 `.obsidian` 設定；完成後檢查其位置即可，不需新增任何範例筆記。

官方操作方式：[Obsidian 儲存庫說明](https://obsidian.md/zh-TW/help/vault)。**已以唯讀方式驗證 GUI 註冊完成**，並新增程式化防護，任何錯誤／重複註冊不得自動修復或修改 Obsidian 全域註冊資料。

## 第一次連接 Naosledge（安全順序）

1. Owner 已指定且核准唯一 MSI 位置：`C:\Naos\Obsidian\Naosledge`。其他資料夾沒有自動授權。
2. 已在系統暫存目錄用**合成 Markdown**完成唯讀 SHA-256 掃描、版本指紋、單邊修改與雙方衝突預演。測試檔案未寫入實際 Vault。
3. 在 MSI 可執行 `npm run verify:obsidian:vault:msi`，只讀取核准 Vault **根目錄**內檔名符合小寫 slug 的 `.md`，顯示數量而非筆記內容。當前結果為 **0 篇**，沒有存入同步基線或與 Neon 連線。詳見 [同步安全預演](OBSIDIAN_SYNC_SAFETY.md)。
4. 若要自動雙向同步，還必須先決定刪除政策（預設絕不自動刪除）、衝突是否每次提示、同步頻率與是否需要 iPhone 一同參與。之後才能設計使用本人 Neon Auth／RLS 的真正執行器，且應先在 Sandbox 驗收。
5. 不安裝背景同步服務、不開放私人筆記到公用網站、不把密碼、Cookie 或 API Token 存進 GitHub Actions。

## 關於 TypeScript

這次新增的 MSI 前置檢查使用 `scripts/obsidian-msi-preflight.ts`，而不是新建 JavaScript 版本。Node.js 24 可以直接執行可抹除型別語法的 TypeScript，但**不會自動執行 TypeScript 型別檢查，也不會讀取 tsconfig 的路徑別名**；因此還須配合 `npm run typecheck`。既有 `.mjs` 測試／腳本可分批遷移，不應為求統一而一次破壞運作中的 CI。詳見 [TypeScript-first 工程規則](TYPESCRIPT_GUIDELINES.md)。

## 尚未完成

- 已完成首次 GUI 註冊與 `.obsidian`／Obsidian 全域註冊唯讀核對。
- 實際遠端筆記的受限讀取方式、版本同步基線保存及後續寫入流程（目前只有本機空白資料夾掃描）
- 真正的本地↔Neon 寫入執行器、回滾與衝突處理
- 如有需要：iPhone 參與及多裝置一致性

本階段不聲稱已完成真正的自動雙向同步。
