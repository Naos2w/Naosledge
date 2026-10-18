# Obsidian 單篇 Markdown 互通 — 手動、零付費、非即時同步

更新：2026-10-18。這是 **Obsidian 互通的基礎**，不是 Obsidian Vault 自動同步，也不是 AI 功能。本功能不需要安裝 Obsidian 插件、建立雲端工作者、升級 Neon 或購買同步方案。

## 如何使用

1. Naosledge 正式網站登入後，開啟私人筆記編輯器 `/vault/[id]`（新筆記也可用）。
2. 點選 **「Obsidian .md」**，瀏覽器會下載以筆記 slug 命名的 Markdown 檔；可自行移入 Obsidian Vault 資料夾。
3. 在 Obsidian 編輯 Markdown 後，回 Naosledge 點選 **「匯入 Markdown」** 選取單篇檔案。若符合安全的 YAML frontmatter 子集，會帶入標題、標籤、分類、日期、摘要、slug 與正文。
4. 匯入前會顯示覆寫編輯器的確認對話；**匯入只更改目前瀏覽器的編輯狀態，不會自動儲存、發布、刪除原文或同步到任何服務**。要同步至 Naosledge，必須由站長明確按「儲存私人筆記」。

## 匯出格式與連結

檔案以 `slug.md` 命名，附上 Obsidian 可讀的 YAML：

```yaml
---
title: "私人知識"
aliases: ["私人知識"]
naosledge_slug: "my-private-note"
summary: "摘要"
category: "學習"
tags: ["知識管理", "閱讀"]
date: "2026-10-18"
---
```

正文保留原始 Markdown 及 `[[slug]]`、`[[slug|標籤]]` 等標記。Obsidian 可用檔名 slug 或標題 alias 辨識連結；**不會連接 Neon、上傳文件或直接發出外部 AI 請求**。

## 有限、安全的匯入格式

只辨識 `title`、`summary`／`description`、`category`、`date`／`learned_on`、`tags`（JSON/YAML 清單）與 `naosledge_slug`。匯出時自動加入的單一 `aliases: [title]` 可被辨識。採嚴格的字串解析，不執行 YAML tag、anchor、script，不讀取額外本機檔案。

**若發現未知欄位、複雜 YAML、非原始標題的自訂 aliases 或不符合限制的格式，會改走原有的「一般 Markdown」匯入路徑，將整段 frontmatter 原樣保留在正文中，避免默默遺失資料。** 這時不保證會自動填入所有屬性；使用者可自行檢查並編輯。

每篇正文上限 200,000 字元，單次選擇單一檔案，無批次資料庫寫入。Obsidian 的 embeds、外掛屬性、附件目錄、跨資料夾重新命名與複雜 aliases 仍須手動整理。

## 未完成的真正雙向同步

「自動同步」仍需決定 Obsidian Vault 在哪台電腦／資料夾、是否使用 iPhone、衝突解決策略、同步頻率、檔案刪除保護及擁有者如何授權本機檔案操作。未確認之前不會掃描或寫入使用者的 Obsidian Vault，也不會偷偷安裝任何背景程式。

## 驗證

- `tests/obsidian-markdown.test.mjs`：嚴格 YAML 解析、中文／Windows 換行、標題別名、Wikilinks、保存未知欄位、安全拒絕惡意 frontmatter、大小／標籤上限、既有 Naosledge 備份相容。
- `npm run test:browser:obsidian:local`：在 MSI 真正 Chrome／Edge 建立一次性、只含合成資料的 Next.js 畫面，驗證 375px 按鈕、下載、匯入、保留未知 YAML、不外連、不儲存雲端。測試後自動移除臨時頁面。
- 不對 Neon Production 執行 CRUD；仍使用 `requireVault()` 的 Auth/RLS、原有的私人 no-store/noindex 防護。
