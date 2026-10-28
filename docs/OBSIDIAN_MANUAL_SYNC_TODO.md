# NaosLedge × Obsidian — 確認版雙向手動同步 TODO (M1–M7)

## 2026-10-28 最新交付：PR #51 已合併、Production 已更新、接續 M6

- **已合併部署且正式驗證通過**：PR #51 已合併至 `main ba4f89ab9a27932ee6553b69649d7fe16f87e965`，合併後 [CI #40614816329](https://github.com/Naos2w/Naosledge/actions/runs/40614816329) SUCCESS。Vercel Production 精確採用該 SHA 的 `dpl_7nzZH8GQ7oh7FGfSMJboQ4e2rCpr` 為 READY，`https://naosledge.vercel.app` alias 已指向新版，正式網站 **14/14 真實 HTTP 健康檢查 PASS**。沒有跑正式 DB Migration、沒有修改真實 Vault 筆記、沒有啟用排程。
- **M6 具體故障：M4 本機完成替換但在 M5 Journal 提交前程序終止**：沿用既有 M5 Journal 與原稿 `backups/`；正常簽章載入仍嚴格拒絕孤兒備份。新增**僅唯讀** `inspectInterruptedM4LocalApply()`，允許診斷一個精確的孤兒備份：先驗 HMAC 歷史和上一版 SHA，要求新鮮固定 Neon Sandbox Owner-RLS＋MSI Vault **兩次完整唯讀重掃**，判斷目前本機仍是歷史版、已等於當前遠端、兩者皆非或本機檔缺失；同時回報殘留原本 `journal.lock`。即使目前相等，也**永遠不**自動補寫 Baseline、不清除鎖、不回滾或再次覆寫原稿，不能視為已證明中斷時成功傳輸。
- **M6 MSI 人工唯讀入口**：沿用舊 `scripts/obsidian-m6-sandbox-uncertain-recovery.ts`，新增 `npm run verify:obsidian:m6:m4:readonly`，固定 MSI、明確旗標、私人 stdin 短效 Sandbox Owner JWT；不允許自訂 URL／路徑。舊 M3 結果不明 `--sandbox-inspect-uncertain-m3-readonly` 仍完整保留。
- **M6 首次下載新檔中斷，已補齊**：M4 `review-missing-local` 使用 `wx` 排他建立檔案後、尚未產生第一筆 M5 簽章而程序死亡，此時**沒有舊稿也沒有孤兒備份**。新增 `inspectInterruptedM4NewNote()` 及原 M6 手動 CLI `npm run verify:obsidian:m6:m4:new:readonly`，只收私人 stdin `sandboxOwnerJwt`、原 M2 `handoff`、原 M4 `receiptPath`。確認 receipt SHA/revision，現有 M5 完整簽章歷史不含同名紀錄，再讀**兩輪**固定已註冊 Vault＋Neon Sandbox Owner-RLS 完整清單，分類本機缺失／吻合原 Incoming／另有改動，以及遠端仍為原審查版本／已改變／不存在。即使結果吻合，也一律**不能視為先前下載成功**、不能補存 Baseline、不能清除殘留鎖或自動重試。已用**真正子程序 Exit 77** 在隨機 OS Scratch 建立本機新筆記後中斷，再由另一個 Node 程序恢復唯讀觀察，並驗證 receipt 竄改、遠端競態、Owner Reader 斷線等拒絕（實測 OS、合成遠端 Reader；非 Live Neon 斷線）。
- **故障驗證範圍（尚非 Live Neon E2E）**：在隨機 OS Scratch Vault/Journals 中，真實 Node **子程序以 Exit 77 中斷**（已完成檔案 rename、備份，但還沒有簽章成功事件），第二個獨立 Node 程序重啟後檢查原稿、保留的備份、舊簽章鏈，並確認診斷成功**但不更新任何 Baseline**；篡改備份／多餘孤兒備份／Owner Reader 模擬斷線都拒絕。此測試的 Owner-RLS 是**隔離模擬 Reader**，並未建立新 Auth 身分或對真實 Neon／實際 Vault 執行故障注入。**真正 M6 Live Sandbox 網路故障驗收與現場清理證據仍待完成；新建檔無備份的重啟診斷已在本輪通過真實 OS／合成遠端測試，不能充作 Neon Live 驗收**；不能在沒有真實資料與新逐篇操作授權下宣稱完全結案。

## 2026-10-28 正式發布與後續 M5 單一路徑

### PR #51：M2 → M3/M4 → M5 實際整合（本輪）

- **不再建立重複架構**：直接重用原本 M2 網頁的逐篇 `handoff` JSON、M3 Sandbox `createNeonSandboxNoteOnly()/updateNeonSandboxNoteIfUnchanged()`、M4 Incoming 與 **同一份** Windows DPAPI-HMAC M5 持久 Journal。
- **上傳成功路徑**：在 MSI 執行 `npm run verify:obsidian:m5:upload:msi`，私人 stdin JSON 需有短效 Sandbox Owner JWT、M2 已選取的上傳 `handoff`，及對應 `UPLOAD M5 SANDBOX <slug> <local SHA 前12位>` 逐篇明確確認。使用者不可指定 Vault 路徑、API URL 或任意檔案。程式先比對新鮮 MSI 已註冊 Vault/Owner-RLS 完整清單，M3 真正執行原有單篇 CREATE/CAS UPDATE 並驗證遠端 SHA/revision，再雙次獨立掃描證實兩端內容仍相同，**最後才**把 `verified-m3-upload` 的前／後遠端 SHA、revision、Owner 身分及 MAC 寫進既有 M5 Journal；任何一步失敗都不寫 Baseline，也不自動重試。真實檔案僅唯讀，沒有覆寫／刪除本機 Obsidian。
- **M4 Incoming → M5 本機套用已實作（本輪）**：原 M2 `review-download`／`review-missing-local`／`conflict` 均先以既有 `npm run verify:obsidian:m4:incoming:msi` 產生獨立 OS Scratch Incoming／衝突副本。只有前兩種、且再次得到逐篇 Owner JWT/RLS 全清單、版本與 M4 receipt 內容吻合，才能由新 `npm run verify:obsidian:m5:apply-incoming:msi`（私人 stdin 需 `sandboxOwnerJwt`、原 M2 `handoff`、原 M4 `receiptPath`、`APPLY M5 SANDBOX <slug> <遠端SHA前12位>`）明確套用到**固定已註冊 MSI Vault**。新檔使用 `wx` 排他建立；既有原稿先在私人 LocalAppData Journal `backups/` 獨立 `fsync` 備份後才 staged+rename，後續雙端 Owner-RLS／Vault 重新確認一致，最後才在**同一份** DPAPI/HMAC 簽章鏈追加 `verified-m4-download` 及前一本地 SHA/備份 SHA。舊事件不可覆寫，歷史缺口／備份遭修改／孤兒備份皆拒絕自動恢復。雙邊 `conflict` 絕不套用或升級 Baseline；任何失敗不自動重試或回滾原稿。已用 **真實 OS Scratch 文件建立、原稿備份與替換** 搭配隔離模擬 Owner-RLS 驗證；**本輪未真正寫入使用者註冊 Vault**，沒有獲新一次真人逐篇操作授權，不能宣稱真人 Live E2E 已驗收。
- **重新啟動後的審查路徑**：`npm run verify:obsidian:m5:review:msi` 用新短效 Owner JWT 驗證**整條既有 HMAC 簽章鏈**，同一 slug 以最新成功上傳／本地下載或人工初始採認的簽章事件作為三方差異基準，重新取得註冊 Vault + Sandbox Owner-RLS 清單，再沿用原 `saveManualM2Handoff()` 產生瀏覽器本機匯入 JSON。M2 網頁仍是人工唯讀審查，不能從頁面直接執行同步；不會帶 JWT 到瀏覽器。
- **目前驗證邊界**：新 Node 真實 OS Scratch + 隔離模擬 Owner-RLS／M3 transport 的 **CREATE → 更新 → Journal → 新程序恢復 M2 差異**，加上 M4 **Incoming → 本機新檔排他建立／舊檔獨立備份與替換 → Journal → 再次檢查** 的整合回歸；涵蓋已提交但回應失蹤、錯誤回讀、過期 M2 決策及 M4 後段遠端修改時 **不生 Baseline**。尚未得到本次真正非空 Vault + Sandbox Owner JWT 新的逐篇真實上傳授權，故不可宣稱真實 Vault↔Neon 完成端到端同步。Production 維持已發布的 `776216f`，M6 真實網路故障驗收仍在後續 TODO。

### M5 下一階段實作：人工採認、可跨程序驗證的持久 Baseline（PR #51 續作）

- **真正的兩種證據不能混淆**：已實作 **Owner 對「目前兩端相同內容」的逐篇人工採認** `manual-adopt-current-equality`，它建立日後三方差異比較所需的**初始 Baseline**，但**絕不證明過去執行過 M3/M4 傳輸**。既有 Scratch equality observation / M3 self-reported witness 不自動轉為可信基準，更不憑兩端 SHA 相同推定已完成傳輸。
- **固定來源及最少人工權限**：`scripts/obsidian-m5-owner-baseline.ts` 僅允許 MSI Windows 上使用私人 stdin、明確 `--m5-adopt-current-equality` 或 `--m5-inspect-approved-baseline`，後端只使用已註冊的固定 Obsidian Vault **唯讀**掃描及固定 Neon Integration Sandbox 的短效 Owner JWT/RLS 完整清單。採認每篇需指定 slug、兩端 SHA、遠端 revision 及文字 `ADOPT M5 SANDBOX <slug> <sha前12字元>`，在取得明確確認前後各執行新鮮雙端掃描，任何來源缺漏／變更／撤權都中止；不允許自訂 Vault/Neon URL、不讀寫 Production、不寫原稿、不做 DELETE。
- **真正持久記錄**：首次採認才於當前 Windows 使用者 `%LOCALAPPDATA%\\Naosledge\\m5-owner-baseline` 建立獨立金鑰／遞增事件日誌。金鑰以 Windows DPAPI CurrentUser 保護，採認事件附 HMAC-SHA256、Owner 身分、固定 Sandbox 分支、精確筆記 SHA/revision、嚴格連續 sequence 和 previous MAC；每次獨立程序重讀整條簽章鏈，再以短效 Owner-RLS 身分與新鮮註冊 Vault 掃描重建差異分類。中斷、竄改、歷史缺口、重複採認、跨帳號、不完整清單、非法 hardlink／reparse point 與不明併發鎖均拒絕，不自動修補日誌。
- **保護界線與已知限制**：日誌在**同一個 Windows 使用者**身分下具有防意外竄改的 HMAC+DPAPI 證據能力，不是遠端公證、TPM 或抗惡意同使用者／整套 Profile 回滾保證。讀取成功僅可當作**人工審核的歷史基準**，M2 後續 `review-upload/download/conflict/both-removed` 仍全部不可自動執行；本模組明確報告 `possibleDeletionsNeverApplied`，從不刪筆記。
- **執行範圍**：已在 MSI 以合成 Owner-RLS Reader、真實 OS Scratch、跨程序 Node 重啟與原生 DPAPI 進行離線驗證；**尚未使用真人短效 Owner JWT + 真實已註冊 Vault 非空相同筆記來建置第一份實際持久 Baseline**。真正 live 採認需要 Owner 再次個別核准與可用 Sandbox Auth 身分。接下來需擴充可信「逐篇傳輸成功」事件，將 M3/M4 完成結果、實際兩端版本及人工操作來源與既有簽章鏈串接；M6 真實斷線復原仍另待驗收。本分支不合併／不部署 Production。

- **正式發布已驗證**：Owner 指名核准後，PR #50 已合併到 `main`（合併 Commit `776216f216736e69fb2850f12e0da358083a8a91`，main CI SUCCESS）。Vercel Production `dpl_FkX3DPxtYFGissEmQuiHEEaRQSkZ` 為 READY，正式 `https://naosledge.vercel.app` alias 直接指向該版，公開/登入/私人頁面/轉址/SEO 真實 GET 檢查 **14/14 PASS**。只更新 Vercel Production 核准 SHA，未執行 Neon Production Migration 或啟用 Vault 雙向同步。
- **下一個 TODO：M5 保存前後雙端重新驗證（新獨立開發分支）**：在 `feat/obsidian-m5-approved-baseline-20261028` 改善 MSI 手動觀察：真正註冊 Vault + Sandbox Owner-RLS 完整清單在保存收據**前後各獨立重讀**，跨程序重新檢視也需先後兩次真實觀察；版本、權限、來源不一致就拒絕及清理本次新產生的 OS Scratch 收據。收據硬連結／讀取中遭修改也應拒絕。這不是新的一份正式權威 Baseline：`baselineSaved=false`、不匯入、不碰原稿、不允許自動寫入或刪除。正式可信授權來源、持久化及 M6 故障復原仍按下面既有 TODO 前進；本分支不自動發布。

## 2026-10-28 最新進度與單一路徑（取代以下 10/26 的舊 PR 狀態）

- **本輪真正 WikiLink E2E 已完成**：Owner 再次明確授權獨立 WikiLink Sandbox-only 模式，MSI 實機執行 `npm run verify:obsidian:m3:wikilink:sandbox:owner:e2e` **Exit 0**；真實 Owner-RLS／M3 CREATE／M4 Incoming／M5 重新檢查／CAS UPDATE／衝突保留／過期版本拒絕皆 PASS，尤其新增 `[[sandbox-target]]` 走固定 Neon SQL003 原子 WikiLink CAS RPC、驗證遠端 SHA、revision 與 backlink 後，再以 RPC 刪除 WikiLink 並重新驗證索引，分別回報 `M3M4_REAL_WIKILINK_CAS_ADD_PASS` 和 `M3M4_REAL_WIKILINK_CAS_REMOVE_PASS`。固定 Integration Sandbox `br-quiet-sunset-b4xx4pnx`，全程沒有真實 Obsidian Vault、正式 Baseline 或 Production 寫入。
- **本輪 Sandbox 清理完整驗收（2026-10-28）**：Owner 已在 Neon Integration Sandbox 的 Auth 使用者介面清除本次臨時身分 `d0872a09-8299-4d1f-a817-04a8c6560ebe`；直接以 Neon 唯讀 SQL 再次驗證：該 Auth User=0、對應 Account=0、站長授權=0，合成測試 slug `m3m4-acceptance-dee333b74cec4b`=0。整個 Integration Sandbox 的 `knowledge_notes=0`、`knowledge_links=0`、`blog_admins=0`、`neon_auth.user=0`、`neon_auth.account=0`。已完成臨時帳號與資料清理，此項不再是待辦；本次未重新執行寫入或修改 Production／Vault。

- **已合併**：#43–#48 與整合 #49 均已於 2026-10-27 合併 `main`，目前 `main` SHA `4f51fa41251312b2e2437116be27b0d7b8918b5e`，#49 exact-head CI `40354567245` SUCCESS。不得再以「#49 待合併」為阻礙，也不要重複開相同功能 PR。
- **2026-10-28 真實 E2E 已通過（PR #50）**：Owner 本次單次核准後，在 MSI 上以 `scripts/obsidian-m3m4-sandbox-live-acceptance.ts` 實際連線固定 Neon Integration Sandbox `br-quiet-sunset-b4xx4pnx`，合成 Owner JWT/`blog_admins` RLS → M2 上傳意圖 → M3 `CREATE` → M5 新 Node 程序 witness/Owner-RLS GET → M4 獨立 Incoming 真實落盤 → M3 `id+updated_at` CAS `UPDATE` → M4/M5 過期版本拒絕 → M4 conflict 雙版本保留 → 精確刪除該篇合成筆記，**腳本 Exit 0**。本輪未驗真實 WikiLink CAS RPC、正式可信 Baseline、網路故障復原或正式 Vault；不是 Production 已上線。
- **2026-10-28 臨時身分清理已全部核實**：M3–M5 真實 E2E 後，曾剩餘 1 個臨時 Auth user/account；Owner 已在 Neon Console 清理。本輪直接用 Neon Integration Sandbox 唯讀 SQL 驗證指定合成身分 `9b57b299-b625-4469-bfc5-90ea83416c6d`：`neon_auth.user=0`、`neon_auth.account=0`、對應 `blog_admins=0`、指定合成 slug `m3m4-acceptance-cd7ce830e09740=0`；全分支 `knowledge_notes=0`、`knowledge_links=0`、`blog_admins=0`、`neon_auth.user=0`、`neon_auth.account=0`。本次驗證僅讀取資料、沒有重新執行任何寫入 E2E，先前一次性授權不再延用。
- **實際剩餘結案項**：M3 真實 WikiLink CAS 新增／移除已通過，本次合成 Auth User/Account 也已經 Neon 唯讀核實全部清理，兩者都從待辦移除。M5 正式可信 Baseline 的授權來源、持久化與可證明的恢復鏈，及 M6 真實斷線／重新啟動／恢復 E2E 尚未完成。M7 Production 發布及真正 Obsidian Vault 變更仍須個別授權。Scratch witness/equality observation 只能當唯讀觀察，絕非已完成同步的可信證據。

### 2026-10-28 集中修復：M3 SQL003／M5 證據／M6 不確定寫入

- **M3 SQL003 唯讀確認／實際驗收模式已接線**：已直接核對固定 Integration Sandbox 的 RPC `update_knowledge_note_cas_with_links` 存在、`SECURITY INVOKER`、完整 11 個參數、`authenticated EXECUTE=true`、`anonymous EXECUTE=false`。PGlite RLS/CAS/WikiLink 回滾回歸已通過；於**同一 PR #50** 的 MSI Sandbox E2E 腳本增加獨立 `--m3-m4-sandbox-wikilink-acceptance` 模式，單一合成 Owner／筆記經原本 M3/M4 驗收後再執行 `[[sandbox-target]]` WikiLink CAS 新增及移除、Owner-RLS/index/SHA 重驗，最後精確清理合成筆記。此模式必須額外提供**新的** `NAOSLEDGE_M3_WIKILINK_E2E_APPROVED=M3WIKILINK_SYNTHETIC_ONLY_20261028` 和通用 Sandbox test acknowledgement；舊 `NAOSLEDGE_M3M4_REAL_E2E_APPROVED` 不會授權 WikiLink 變更。**本次已獲 Owner 個別授權並完成真正 Neon Owner-RLS WikiLink CAS 新增／移除、索引確認及合成筆記清理，Exit Code 0**；本輪測試身分也已由 Owner 刪除且 Neon 唯讀 SQL 確認 Auth user/account 皆為 0，正式 Baseline／Vault 功能仍沒有啟用。
- **M6 真正故障缺口已補程式（僅離線驗證）**：新增 `scripts/obsidian-m6-sandbox-uncertain-recovery.ts`（MSI 專用、明確唯讀旗標、stdin 限量輸入），連到 `inspectUncertainM3SandboxOutcome()`。若 M3 POST/PATCH 可能已提交但回應遺失、無 M5 witness，須提供先前審查的 Markdown SHA、原遠端 SHA/revision（首次 CREATE 兩者皆 null）與同一份 canonical Scratch Markdown，用兩次獨立授權的 Owner-RLS 完整遠端 GET，分類為 `matches-supplied-scratch`／`reviewed-remote-still-present`／`different-now`／`absent-now`。遠端版本競態、第二次 GET 失敗、缺 Owner 身分立即拒絕；**各種結果都不證明先前寫入已成功、不發起重試、不可保存 Baseline**。已新增真實 Node 測試注入「POST 已提交、HTTP 回應遺失」的離線情境；不是已執行真實 Neon 斷線驗收。
- **M5 可信 Baseline 最小驗收契約（尚未實作正式寫入）**：既有 Scratch witness / equality observation / 外部提供的 SHA 都是**未驗證來源的觀察**，不得被轉成已授權的正式持久 Baseline。**本輪安全補強已完成**：`reverifyM3SandboxWitness` 在本地 receipt／單篇遠端 GET 核對後，再以同一短效 Owner JWT 重新驗完整 Owner-RLS 遠端 Inventory，並再次確認 receipt 位元組未變；後段 remote revision 變動或 Owner grant 撤銷即拒絕。API 現明確回傳 `transferConfirmed=false`、`trustedBaselineEligible=false`、`baselineSaved=false`，避免把當下相符誤當歷史同步證明，相關真實 Node 故障注入回歸已通過。後續仍須取得與逐篇決定綁定的 Owner 授權來源、實際固定 Vault 原始內容雙掃描、固定 Neon Owner-RLS 完整 GET、跨程序可信的成功寫入事件及可確認的先後順序，才能設計正式持久化；任何資料不符、中斷、歷史歧義一律人工處理。不以離線 PASS 數量替代可信來源或真實驗收，也不新增 Agent/框架。
- **目前實際下一步**：WikiLink 真實驗收已完成，不重做、不新開 PR；沿用 PR #50 推進 M6 在 PATCH 回應不確定時的版本判斷及 M5 可信 Baseline 的來源設計。M6 新版要求原始 M2 審查的 `reviewedRemoteSha/revision`（CREATE 兩者皆 null），對 UPDATE 區分「原審查遠端尚在」、「已與欲上傳內容相同」、「他人修改或版本改變」、「目前不存在」；任何結果皆不可自動重試或推斷正式 Baseline 成功。新的真實故障注入或 Production／Vault 寫入仍另行授權。

更新：2026-10-26；M1/M2 已完成真實 Neon Integration Sandbox 合成 Owner JWT／RLS → MSI 唯讀掃描／JSON → 本機 Chrome 審查整合驗收。尚未部署 Production。

**2026-10-26 23:50 集中整合候選（尚未合併 main）**：目前正式 main 保持在 `7971fa486ef9fc8ef724493c90ba533c6ecb2b7a`（#42；CI #164 SUCCESS）。已在獨立 `integrate/obsidian-m3-m5-delivery-20261026-23` 分支以原 Git 提交歷史整合 #43（M5 Scratch 跨程序重啟檢查）、#44（M4 Incoming Owner-RLS 當下重驗）、#45（M5 雙版本 Browser 純本機比較）、#46（M2→M3 審查交接 JSON）、#47（M3 verified Scratch witness → M5 重驗）與 #48（已註冊 MSI Vault／Sandbox Owner-RLS 雙端 SHA 相同的觀察收據）。已將 6 個 PR 的 Vercel 禁用設定及整合分支一同保留，測試通過後仍需 Owner 授權才可合併到 main。**新增獨立整合測試** `tests/obsidian-m6-integrated-handoff-witness.test.mjs`，使用離線 Owner-RLS HTTP 模擬＋實際 OS Scratch，完成 M2 審查意圖 → M3 one-note CREATE → 自動輸出 metadata-only witness → 新 Node 程序重讀 → M5 Owner-RLS 重新確認；測試涵蓋已撤銷 Owner 授權及本地 SHA 被改動時拒絕，沒有真實 Neon 或 Vault 寫入。

**實際剩餘 blocker（不得誤報結案）**：M3／M4 仍缺**新一次明確批准**的真實 Sandbox Owner JWT/RLS/API／MSI E2E（安裝 SQL003 不等於有執行 RPC）；M5 現有 Journal／receipt／observation 仍為本機 Scratch 自述資料，**並非受信任的正式 Baseline、沒有持久身分認證／授權交易鏈、不能自動認定同步成功或重新載入 Baseline**；M6 真實故障／恢復及清理驗收未完成，M7 Production↔正式 Obsidian Vault 部署需另外授權。下一步優先一次整合驗收與可信 Baseline／實際 E2E，不再零碎開相同功能的 PR。

**2026-10-26 實際基準更正**：PR #35–#40 已合併 main（`2cf082d6fbdbdc40e944e16e56027642584e9c53`；CI #157 SUCCESS），不可重做；PR #41 的 MSI M2→M4 交接已合併 main（`d551d86bfd11b8a863d8d74431fcee5bc7609b26`；CI #162 SUCCESS）；PR #42 的 Incoming 雙副本與 receipt 已合併 main（`7971fa486ef9fc8ef724493c90ba533c6ecb2b7a`；main CI #164 SUCCESS）。Owner 先前單次核准的 SQL003 已以單交易安裝到 Neon `bitter-silence-36632892` **Integration Sandbox** `br-quiet-sunset-b4xx4pnx` / `neondb`，`update_knowledge_note_cas_with_links` 存在且 `SECURITY INVOKER`、authenticated 可執行／anonymous 不可執行，合成 notes／links／admins／Auth user 均 0；Production `br-aged-sound-b43h5r2c` **沒有 SQL003**。**這不代表 M3 Owner JWT／POST／PATCH／CAS 真實 E2E 成功**，也不能在日後排程重用當次核准進行寫入。

**2026-10-26 晚間 main/候選再核對**：PR #41/#42 已合併，main 現為 `7971fa486ef9fc8ef724493c90ba533c6ecb2b7a`，CI #164 SUCCESS；PR #43（M5 Scratch 跨程序預檢）、#44（M4 Incoming Owner-RLS 唯讀重驗）、#45（本機雙版本 UI）、#46（M2→M3 人工上傳意圖）各自仍為未合併候選、exact-head CI 已成功；不得重開重做。下述里程碑表為既有基準敘述，尚未包含這些未合併候選。SQL003 僅已安裝 Integration Sandbox，Production 未安裝；未取得本輪真正 Owner JWT/M3 寫入及 M6 Sandbox E2E 授權。

**2026-10-26 M5 待驗候選**：新 MSI 手動入口 `scripts/obsidian-m5-manual-equality.ts` 可呼叫既有已註冊 Obsidian Vault 雙次唯讀掃描與固定 Neon Integration Sandbox Owner-RLS 完整 GET，將當下兩端 **SHA 相同且有遠端 revision** 的筆記保存為 OS Scratch 中獨立、metadata-only、排他建立的「觀察收據」，並供新程序以新的 Owner JWT 再次重新掃描兩端驗證。它**不是可信的已完成同步證據、沒有驗證過人工上／下載完成、不會載入／儲存正式 Baseline，也不會覆寫任何資料**。本輪本機 HTTP 部分僅使用合成 Reader；真正 Sandbox 身分／Owner GET 與正式持久 Baseline 完成仍受授權限制。PR #43–#47 為另外未合併的候選，不能當成 main 既有功能。

## 不得更改的產品契約

- **Obsidian 與 NaosLedge 都是正式編輯入口**，任何一邊編輯都不構成對另一邊的覆寫授權。
- **預設手動觸發，同步前逐篇確認**；沒有自動同步、背景輪詢或自動套用。
- **雙邊修改時保留兩個版本**，不依檔案日期判斷勝負。
- **絕不自動刪除**：單邊缺少檔案、兩邊均缺少但基準仍存在，都不觸發實際刪除或清理基準。
- 私人內容使用站長 Auth + Neon RLS，公開部落格的發布與私人筆記同步獨立。
- 尚未經核准的真實 MSI Vault／Neon Production 寫入一律保持關閉。
- **一般開發不再等待獨立 QA Agent**：由 Developer 實作並執行受影響的單元測試、型別檢查、Build、必要的 UI 測試與 GitHub CI；正式部署或真實資料寫入仍遵守既有安全／授權閘門。

## 最新優先 TODO（2026-10-26）

1. **P0｜M1/M2 真實 Sandbox 端到端驗收已通過**：PR #26–#33 已合併 `main`；本輪 PR #34 修正正式審查頁不再預設顯示合成筆記，補上 MSI→Chrome 真實檔案交接測試。**2026-10-26 MSI 實機成功**：Neon Integration Sandbox 暫時合成 Owner JWT／`blog_admins` RLS 驗證、真實 `knowledge_notes` GET（1 篇獨立合成筆記）、Obsidian 本機唯讀掃描（0 篇）、M1 差異判斷、M2 CLI 本機 JSON、Chrome 匯入與選擇「預定下載」均 PASS。無筆記同步、Production 或 Vault 寫入。結束後再次 SQL 驗證 Sandbox 私人筆記、連結、站長授權、Auth 使用者、Auth 帳號全為 0。**限制：M2 網站端驗收使用 localhost Chrome 實際元件／臨時測試路由，不等於正式 Vercel 的真人登入與部署驗收。**
2. **P1｜真正的 M1 唯讀驗收**：2026-10-24 在真正 MSI 上完成安裝／GUI 註冊及固定路徑唯讀掃描（0 個直接 Markdown、0 個未涵蓋資料夾、0 次寫入）。新增手動工具 `scripts/obsidian-msi-manual-preview.ts`，可從 stdin 一次性取得 Sandbox Owner JWT，先以 `blog_admins` 本人 RLS 列驗明 Owner 身分，再執行真正的 Owner-RLS 筆記 GET（避免非 Owner 收到 200 空清單卻被誤判成功）；**2026-10-26 已使用臨時合成 Sandbox Owner JWT 真實執行 Owner-RLS GET 並通過（測試完成即撤銷身分及授權）**。新增 PostgREST `Prefer: count=exact`＋嚴格 `Content-Range`/回傳筆數一致性檢查，避免即使 Owner 驗證成功，伺服器限制筆數或未回傳完整清單時仍誤將空清單／局部清單視為 `fullInventory=true`；缺少精確總數也拒絕預覽。認證失敗、超限或不完整時必須停止；真實 Sandbox Owner-RLS 完整清單已完成一次非空驗收；超限／錯誤清單仍由離線負向測試驗證拒絕行為。
3. **P1｜M2 真實唯讀預覽接線**：私人 `/vault/sync` 現在預設**不顯示合成筆記**，只在本人手動匯入通過完整驗證的 MSI JSON 後顯示差異；保留逐篇選擇、SHA／遠端 Revision 與「未涵蓋筆記」警示；不提供任何實際傳輸、刪除或自動執行。**2026-10-24 已加強 M2 合成／未來唯讀預覽的資料完整性驗證**：驗證完整 Inventory、7 類差異計數、SHA／Revision、缺漏警示與逐篇方向一致；遠端指紋與 Revision 必須成對存在，不能有 SHA 卻缺少 Revision 就讓使用者選擇操作（已新增先失敗後通過的回歸測試）。錯誤／截斷／矛盾清單一律拒絕。修正合法 slug `constructor` 被 Object 原型屬性錯認為使用者選擇的問題；已整合 MSI 人工匯出與 M2 瀏覽器本機匯入，2026-10-26 已使用真正 Sandbox 合成站長 JWT 完成 GET → JSON → MSI Chrome 的非空資料端到端驗收；尚未於正式 Vercel 網站使用真人 Production 站長會話驗收。
4. **P1｜M3 Sandbox 手動上傳**：PR #29 新增固定 Neon Integration Sandbox 的 create-only POST 元件，以及 `scripts/obsidian-m3-sandbox-manual-create.ts --sandbox-scratch-create-only` MSI 人工單篇入口。僅接受 stdin 傳入的**合成／獨立 Scratch 可攜式 Markdown**、短效 Sandbox-only Owner JWT 與 `CREATE SANDBOX <slug>` 明確確認；先驗 Owner RLS 與完整清單，拒絕同名覆寫、PATCH／DELETE，不寫 Baseline，結果不明不得自動重試。輸入不讀真實 Obsidian Vault，也不視 M2 UI 選擇為寫入授權。**離線 HTTP 模擬與 CLI 輸入驗證不等於真正 Neon Sandbox POST 成功**；需 Owner 在本機安全取得短效 JWT 並明確逐篇批准後才可驗收。M3 既有筆記的低階 Sandbox 條件式 PATCH 已新增候選實作：先用 Owner RLS 完整清單驗證審查版本、GET 原 row ID/updated_at、重新讀取本機 SHA，再以同一筆資料庫 PATCH 的 `id + slug + updated_at` 條件避免遠端並行覆寫，成功後再 GET 驗證；任何 0 筆更新、競態或結果不明都不自動重試、也不更新 Baseline。已通過假 HTTP 測試，並已新增 MSI 手動 stdin 更新入口；未進行真正 Sandbox JWT/PATCH 驗收，更不操作真實 Vault。
5. **P2｜M4/M5**：M4 除既有合成 Incoming 副本預演外，PR #30/#32 已合併：固定 Neon Sandbox Owner-RLS 單篇唯讀 GET、重新驗證 SHA/revision、獨立 OS 暫存 Incoming 副本及 MSI 人工單篇入口；目前只通過模擬 HTTP＋真實隨機暫存檔測試，沒有真人 Neon GET 或原稿寫入；M5 已新增**隨機 Scratch 專用 append-only 成功證據、限量雙版本行比較及唯讀日誌重新載入預檢**。恢復預檢遇到多筆同名歷史、版次變更、兩端差異或記憶體 Baseline 不一致會保守標示、絕不推斷勝者或自動匯入。正式 Vault／Neon 持久化、真正 MSI 下載適配器、跨程序重啟後可信載入及 UI 接線仍待開發／授權；任何刪除仍需另外的明確人工決定。
6. **P2｜M6/M7**：新增 `tests/obsidian-m6-synthetic-cross-stage.test.mjs`，先以隨機 Scratch／記憶體 Remote 跨階段回歸 M1 預覽、M2 非執行選擇、M3 逐篇上傳、M4 Incoming 保留雙份、M5 只記錄已驗證一致的 Baseline，以及過期版本／漏掃／不完整清單的 fail-closed 行為。**這不是 Neon 或 MSI 真實 E2E**，仍須另外完成真正 Sandbox Auth／RLS／API＋MSI 測試與回復驗收；M7 正式啟用仍需 Owner 個別授權。

**本輪 M5 可執行交付（候選，待 CI／合併）**：新增 `scripts/obsidian-m5-scratch-recovery.ts --synthetic-readonly <OS-temp-scratch-path>`，讓**不同 Node 程序**透過 stdin 接受明確完整的合成遠端指紋清單，唯讀重新開啟上一程序的 OS 暫存 Scratch `baseline-journal` 與本地筆記，逐篇輸出匹配／本地改變／遠端改變／雙邊改變／缺少日誌／多筆歷史不明。共用既有日誌的嚴格 JSON 與 SHA 驗證；拒絕非 OS 暫存、漏掃與損毀來源；不還原、匯入 Baseline、刪除或寫入。新增真正子程序執行回歸測試。**遠端快照仍是呼叫者提供的離線資料，沒有驗證真人 RLS 身分、不可當作正式可信 Baseline 或真正 Neon E2E**；正式持久證據認證、整合及 M6 真正 Sandbox 寫入驗收仍待授權與實作。**PR #41（M4 handoff）及 #42（M4 conflict pair／跨程序 Incoming receipt）已經 Owner 個別批准並合併 `main`，合併後 `7971fa486ef9fc8ef724493c90ba533c6ecb2b7a` 的 CI #164 SUCCESS。** PR #43 已在全新隔離 worktree 整合此 main，保留 M4 完整交接／雙副本收據和原本 M5 Scratch 恢復預檢；41 項 M4/M5 定向測試通過。此候選仍只具備離線跨程序預檢，不是正式可信 Baseline；尚未取得 #43 合併或真實 Sandbox 寫入授權。

**2026-10-26 M2→M3 單篇上傳交接（新增候選，尚未合併）**：私人 M2 審查頁在本人匯入完整 MSI Sandbox 唯讀快照、逐篇選「預定上傳」且本機清單無漏掃後，可透過瀏覽器 Blob 下載該篇 `naosledge.m3.sandbox-upload-intent.v1` JSON。僅含 slug、`review-upload`／`review-missing-remote` 方向與兩端 SHA/revision，不含 JWT、Markdown、Vault 路徑或執行授權。MSI M3 create-only Scratch／conditional UPDATE CLI 另以 stdin 接受完整 `handoff`（仍相容既有 `decision` 或無 handoff 的 Scratch 建立），嚴格驗證六欄方向及所有 SHA、當次重新取得的 canonical Markdown 位元組與 slug；此外仍需另行輸入短效 Sandbox Owner JWT 及 `CREATE SANDBOX <slug>`／`UPDATE SANDBOX <slug>` 明確文字確認，對真正遠端版本再次 Owner-RLS GET／CAS。缺欄位、修改後的本地 SHA、缺少修訂、錯誤方向、混入其他欄位、部分本地掃描均拒絕，不會有自動傳輸／重試／Baseline／刪除。僅離線 HTTP 模擬與本機 Node 測試，**不是**真實 Sandbox Owner E2E 或 Vault 正式上傳；M3 真實寫入仍須新的單次 Owner 批准。

**暫緩**：PR #21–25 安全研究整合、TPM/DPAPI、企業級 AES 備份輪換、強制斷電實驗、Cron 自動同步及自動覆寫。這些不是 M2／M3 一般開發前置條件。

## 正式里程碑

| 階段 | 具體內容 | 可驗收的完成標準 | 當前狀態 |
| --- | --- | --- | --- |
| **M0** | 兩邊皆可編輯、手動逐篇確認、衝突不覆寫、不自動刪除 | Owner 已確認 | **完成** |
| **M1** | 把現有本機 SHA 掃描、Neon Sandbox RLS 唯讀清單，交給同一份差異預覽 | 完整遠端清單才產生預覽；同名初次差異→衝突；缺失、兩邊修改與未覆蓋檔案都可見；M1 完全不寫入 | **已合併 main；2026-10-26 MSI 本機與真實 Neon Sandbox 合成 Owner JWT／RLS／非空 GET 完成 M1 端到端驗收。沒有啟用正式同步或 Production 寫入** |
| **M2** | 私人站長審查畫面：上傳、下載、保留兩份、略過；逐篇選擇 | 站長限定、M1 差異卡片、兩端 SHA／遠端 Revision、逐篇選擇、衝突方向限制、摘要、RWD／鍵盤驗收；不執行同步 | **PR #27/#28/#31 已合併 main；本輪完成實際 Sandbox Owner-RLS GET → MSI JSON → Chrome 獨立檔案匯入／逐篇選擇／清除端到端驗收。正式頁改為空白待匯入；Production 網站真人登入及發布尚未驗收，也未啟用同步。詳見 [M2 規格](OBSIDIAN_M2_REVIEW_UI.md)** |
| **M3** | Obsidian → NaosLedge 的逐篇上傳 | 僅允許本人、Sandbox 首驗、建立/更新前重新讀取 SHA/Revision；失敗不更新 Baseline；沒有 DELETE | **PR #29 已合併 `main`，具備固定 Neon Sandbox create-only POST 與 MSI scratch-only 手動 stdin 入口；模擬 HTTP 單篇建立驗證已通過。本輪已補 WikiLinked 新筆記經現有 Owner-RLS 原子 RPC 寫入並核對索引的隔離候選（未執行真正 Sandbox RPC）。既有筆記的條件式 Sandbox PATCH 低階候選元件已通過離線模擬；已新增 MSI 逐篇更新入口；尚無真正 Sandbox JWT／POST／PATCH 驗收、真實 Vault 串接或正式同步授權** |
| **M4** | NaosLedge → Obsidian 的逐篇下載 | 先在獨立 Inbox/Incoming 產生新檔；已存在原稿不直接覆寫；本人另行決定如何合併 | **合成 Scratch Incoming 副本已測試；PR #30 新增固定 Sandbox Owner-RLS 單篇 GET 與獨立 OS Incoming 副本，模擬 HTTP/隨機暫存檔驗證通過；尚無真人 MSI/Neon GET 驗收，不接觸 Obsidian 原稿** |
| **M5** | 衝突比較與 Baseline 持續記錄 | 僅在已核准成功且已再次確認兩邊內容一致後保存 Baseline；離線、rename、重試不得誤覆寫或清除 | **合成 Scratch 的逐篇 Baseline append-only 證據、唯讀雙版本行比較及唯讀日誌重新載入預檢已實作；衝突保留、還原不清除 Baseline 已驗證。真正可跨程序重啟並驗證來源的持久載入、正式資料層／UI 接線仍待開發** |
| **M6** | 在獨立 Sandbox 做真實 Auth/RLS/API ＋ MSI 測試 | 上傳、下載、同名雙改、部分清單、網路失敗、回復與防刪案例通過，測試資料清理留證據 | **合成 M1–M5 跨階段安全回歸已新增；真實 Neon Sandbox＋MSI E2E 仍待開發／授權，不可視為驗收完成** |
| **M7** | 正式 Vault ↔ Production 受控啟用 | Owner 指定資料範圍／備份位置／逐篇授權、功能及安全驗收、精確發布 SHA 與回復計畫；遵守正式發布閘門，不以一般開發獨立 QA 作額外要求 | 需另行授權 |

## M1 MSI 真人唯讀驗收入口（2026-10-24）

- **2026-10-24 M1 遠端唯讀快照一致性**：`previewManualObsidianSync()` 在 Owner-RLS Reader 取得遠端完整清單後，先記錄當次遠端指紋與完整性旗標的不可共用序列化快照；第二次本機唯讀掃描完成後，再確認遠端 Reader 提供的物件沒有被其他 callback 更動。若 SHA、`fullInventory` 或 `numberOfNotes` 被改動，拒絕預覽，不能把已驗證過的清單誤當成目前清單。新增三種確定性模擬測試；**僅是離線邏輯保護，不等於再次讀取真正 Neon，也不授權任何傳輸**。
- **2026-10-24 本輪唯讀預覽參考競態保護**：`previewManualObsidianSync()` 在執行非同步本機與遠端 Reader 前記住 Baseline 的原始指紋，於首次本機讀取後及最終規劃前檢查 Baseline 未變；並對首次本機 Manifest 留下獨立序列化快照，防止 Reader 重用同一可變物件時掩蓋遠端 GET 期間的筆記變更。首次本機指紋不合法即拒絕且不啟動遠端 Owner GET。新增三種離線確定性回歸測試，**不涉及任何真實 Vault／Neon 寫入，也不能替代真正的 Sandbox Owner-RLS 驗收或傳輸前版本重驗**。
- **2026-10-24 M1 Owner-RLS 清單禁止快取**：對固定 Neon Sandbox 的 `blog_admins` Owner 身分 GET 和 `knowledge_notes` 清單 GET 都明確設定 `cache: "no-store"` 及 `Cache-Control: no-store`，防止未來在支援 fetch 快取的執行環境誤用舊的 Owner 授權或筆記清單；合成 HTTP 測試確認兩個請求都使用相同禁快取契約。這只是唯讀請求防護，不等於已取得真正 Sandbox JWT／遠端驗收，也不授權寫入或同步。
- **2026-10-24 M1 遠端 GET 期間本機變更防護**：`previewManualObsidianSync()` 在取得完整 Owner-RLS 遠端清單後，會再次唯讀掃描本機，並比較所有已掃描指紋與未涵蓋內容計數；若遠端請求期間發生本機內容變更、新增未掃描資料夾，或第二次掃描失敗，一律拒絕過期預覽。新增真實合成 FS + 模擬遠端的確定性回歸測試。這不能取代真正傳輸前的雙邊版本重驗，也不是鎖定檔案、Sandbox 真實 GET 或正式同步啟用。
- **本輪本機覆蓋率安全修正**：`lib/obsidian-local-manifest.ts` 不再把 Vault 根目錄的符號連結／Windows junction（例如連到外部 `nested-notes/`）當成一般非筆記檔而錯報 `ready`；若出現任何根目錄連結，直接拒絕唯讀 Inventory，且 M1 不呼叫遠端 Reader。唯讀合成測試覆蓋連結資料夾與預覽 fail-closed；沒有掃描連結目標、寫入或觸發同步。
- **2026-10-26 再驗證**：已於正式 MSI 執行 `npm run verify:obsidian:msi` 與 `npm run verify:obsidian:vault:msi`，Obsidian 安裝及 GUI 註冊正常；支援 Markdown 0、未掃描資料夾 0、cloudComparisonPerformed=false、localWrites=cloudWrites=0。另執行 `npm run verify:obsidian:neon:sandbox:anonymous`，固定 Neon Sandbox 三個資料表均拒絕匿名操作、沒有使用寫入方法。**這仍不是** 真正的 Owner-RLS 遠端 GET。
- `npm run verify:obsidian:m1:sandbox:first-look:msi` 是**手動**、僅限 MSI 的首次無 Baseline 唯讀入口；必須另外加 `--sandbox-first-look-readonly` 旗標，並從 stdin 管線傳入**短效、僅供 Neon Sandbox 的 Owner JWT**。它只呼叫既有固定路徑 Vault 掃描和固定 Neon Sandbox GET，沒有參數式 Vault 路徑、Production URL、寫入、刪除、下載、部署、背景輪詢、Baseline 保存或可執行的審查批准。
- 符合條件的 MSI PowerShell 人工操作方式如下。這個示例僅供經授權真人手動操作，**不可貼上 JWT 到聊天、命令列參數、GitHub 或任何記錄檔，也絕不能改用 Production JWT**：

```powershell
$secret = Read-Host 'Short-lived Sandbox OWNER JWT' -AsSecureString
try {
  [System.Net.NetworkCredential]::new('', $secret).Password | node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-msi-manual-preview.ts --sandbox-first-look-readonly
} finally {
  Remove-Variable secret -ErrorAction SilentlyContinue
}
```

- 終端只輸出筆數、衝突數、未涵蓋數與不允許操作旗標，不會列出 Markdown、slug、SHA 或 JWT。首次 Baseline 為 `[]`，代表「沒有既定同步基準」，**不是同步成功或任何覆寫授權**。沒有有效 Sandbox Owner JWT 時，此項仍列為待驗收，不能宣稱成功。

- **M2 MSI → 站長瀏覽器安全交接**：已合併 #31 的 `--sandbox-m2-readonly-handoff` MSI 單次手動匯出與 #28 的瀏覽器本機 JSON 匯入。MSI 端將通過 Owner-RLS 的快照寫入使用者本機排他建立的臨時 JSON，只輸出路徑；檔案含私人 slug／SHA／revision，不含 Markdown 正文或 JWT，匯入後須由本人清理。此流程尚未取得真正 Sandbox Owner JWT 或真人端到端驗收，且不授權任何同步寫入。

## M3 上傳隔離預演（2026-10-24）

- **2026-10-26 M3 existing-note WikiLink 原子更新候選（未部署）**：本輪新增**獨立候選** `neon/migrations/003_m3_wikilink_cas_candidate.sql`，定義新 `SECURITY INVOKER`／Owner RLS RPC `update_knowledge_note_cas_with_links`：鎖定並以完整 `id + slug + updated_at` 做 SQL CAS，再核對舊的 outgoing `knowledge_links`，於**同一個 PostgreSQL transaction** 更新既有筆記及替換 WikiLink 索引，任何不一致／權限不足全交易回滾。M3 MSI 手動逐篇更新入口現在遇到**新增、變更或刪除 WikiLink** 時只走此新 RPC，先重讀遠端原稿與索引，完成後再 GET 重驗新筆記 SHA／revision、完整 backlinks 及整體 Inventory；RPC 不存在或連線結果不明**絕不降級為舊的無 CAS save_knowledge_note(p_id!=null)／PATCH、不自動重試、不保存 Baseline**。沒有 WikiLink 的既有 PATCH CAS 路徑維持不變。本輪以真實 PGlite SQL transaction/RLS 測試及隔離 HTTP／MSI stdin 回歸驗證候選；**SQL 003 已在 2026-10-26 經 Owner 當次批准、以單交易成功安裝於獨立 Neon Integration Sandbox（bitter-silence-36632892 / br-quiet-sunset-b4xx4pnx / neondb），Production（br-aged-sound-b43h5r2c）未安裝**。Sandbox 函式 `public.update_knowledge_note_cas_with_links` 已確認 SECURITY INVOKER、authenticated 可 EXECUTE、anonymous 不可；安裝後合成資料、筆記、連結、Auth 均為 0。**真正 Sandbox Owner JWT／POST／PATCH／CAS E2E 仍未執行／未通過**；既有授權不可重用，下一次真正 Sandbox 寫入、Auth 建立、Migration 或正式使用仍須 Owner 當次個別同意且工具允許。

- **2026-10-25 MSI 單篇條件式更新入口（PR #33，尚未真人驗收）**：`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-m3-sandbox-manual-update.ts --sandbox-manual-update-only`，僅接受 MSI 人工 stdin JSON，且恰含 `sandboxOwnerJwt`、`markdown`、`decision`、`typedConfirmation`。Owner 必須使用真實 M1/M2 審查取得的 `review-upload` 決策（完整本地／遠端 SHA 與 revision），提供與本地 SHA 相符的 canonical Markdown，並另行逐篇確認 `UPDATE SANDBOX <slug>`；工具不推造決策，也不能證明輸入決策的來源。JWT 只在本機以短效 Sandbox-only 身分透過 stdin 輸入，不能貼入聊天、argv、env 或日誌。工具重用既有 Owner-RLS／完整清單／原子 CAS PATCH／回讀驗證，不讀寫 Vault、不存 Baseline、不自動重試；失敗可能已寫入 Sandbox，必須本人先檢查。只有離線模擬及 CLI 拒絕測試，真正 JWT/PATCH 驗收仍為 `blocked_needs_owner`。

- **2026-10-24 新增真實 Neon Sandbox API create-only 傳輸元件（尚未真人啟用）**：`lib/obsidian-neon-sandbox-create.ts` 只對固定非正式 Sandbox 執行 Owner-RLS 自身驗證、完整遠端 GET、單篇 POST INSERT、再次完整 GET 驗證 SHA/revision；需單篇 `review-missing-remote`、一致的可攜 Markdown SHA 與另外輸入的 `CREATE SANDBOX <slug>` 確認字串。**傳輸前現在透過 `readMarkdown()` 回呼在 Owner GET 完成後重新讀取本機來源並比對原 M1 SHA**，避免將預覽當時快取的 Markdown 寫入已變動的筆記；既有 `(owner_id,slug)` 唯一限制拒絕並行撞名；無 upsert/PATCH/DELETE、無 Baseline 寫入，失敗不自動重試。`tests/obsidian-m3-neon-sandbox-create.test.mjs` 以模擬 HTTP 驗證實際請求形狀、Owner 閘門和撞名拒絕，**不是 Neon 真實寫入驗收**。現有 Scratch-only 人工 MSI 入口，但未取得短效 Owner JWT、未執行真正 Sandbox POST，仍需真人逐篇授權與完成 M3 update-CAS／復原設計；不得將此低階介面視為正式同步開放。

- **M3 真人驗收操作（尚未執行）**：僅在 MSI 的 PowerShell 7（UTF-8）以**另行製作的合成 Scratch 筆記**操作；此命令會真的對 Neon Sandbox 建立一篇筆記，須逐篇另行確認，切勿傳入真實 Obsidian Vault 原稿或 Production JWT。JWT 與正文僅以 stdin 一次性送入子程序，勿貼到聊天、命令列或 CI。沒有短效 Sandbox Owner JWT 時不要執行：
```powershell
$note = Get-Content -LiteralPath 'C:\\Temp\\naosledge-synthetic-note.md' -Raw -Encoding UTF8
$confirmation = Read-Host 'Type CREATE SANDBOX <slug>'
$secret = Read-Host 'Short-lived Sandbox OWNER JWT' -AsSecureString
try {
  @{ sandboxOwnerJwt = [System.Net.NetworkCredential]::new('', $secret).Password
     markdown = $note; typedConfirmation = $confirmation } |
    ConvertTo-Json -Compress |
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-m3-sandbox-manual-create.ts --sandbox-scratch-create-only
} finally {
  Remove-Variable secret,note,confirmation -ErrorAction SilentlyContinue
}
```
  僅在新建後再 GET 的 SHA/Revision 核對成功時顯示成功；不自動清理、重試、更新 Baseline，也不能視為真正 Vault 雙向同步。

- `lib/obsidian-durable-write-sandbox.ts` 已新增 `SyntheticUploadConsent` 與 `approvedUpload()`：只允許從作業系統**新建的隨機暫存 Scratch** 讀合成 Markdown，更新**同一進程內的合成 Remote Map**；無 Neon HTTP、無實際 Obsidian Vault 路徑、無真實 Owner JWT。
- 只有 M1 規劃器回報 `review-upload` 或 `review-missing-remote` 才提供 `uploadConsents`。逐篇授權含亂數 nonce 與 10 分鐘期限，僅一次有效；上傳前及人工介入後再次比對兩端 SHA、遠端 revision，版本變動、雙改衝突與非法方向一律拒絕。
- 合成遠端首次建立與更新皆可單獨驗收；**成功驗證兩端內容相同後**才更新合成 Baseline。失敗不更新 Baseline，不執行 DELETE；此項不代表 Neon Sandbox 真實寫入功能已完成。
- 既有 `consents` 仍只供下載預演，新增的 `uploadConsents` **不能當作 M2 React 選擇、真實寫入授權、API 憑證或正式同步工作清單**。後續仍要補真正的 Owner Auth / RLS + Sandbox E2E，並確認遠端寫入有版本條件與恢復策略。

- **2026-10-26 M3 WikiLink/backlink 防護（離線實作）**：發現現有 M3 固定 Sandbox 直接 `POST/PATCH knowledge_notes` 不會同步維護應用程式 `save_knowledge_note()` 管理的 `knowledge_links`，可能造成反向連結索引不一致。現在建立前拒絕正文中可作用的 `[[WikiLink]]`；條件式更新前還會核對**新版及遠端舊版**內容皆無作用中的 WikiLink，並以同一 Owner JWT/RLS GET 確認舊筆記 `knowledge_links` 出站索引總數確實為 0。若索引查詢缺失、非完整回應或有舊連結，一律**在 POST/PATCH 之前拒絕**；無連結筆記仍保留原單篇手動／CAS 路徑。M3 相關離線 HTTP／CLI 21/21 PASS，新增 4 項負向案例（新增／移除連結、索引非空／缺少完整性）。**沒有呼叫真實 Sandbox POST/PATCH，沒有 Production、Vault 或 Baseline 寫入。** 下一步在經批准的 Sandbox 隔離 schema 設計及驗收能**單一交易**同時維護 `knowledge_notes`、`knowledge_links` 與樂觀版本條件的寫入器；在那之前不開放帶 WikiLink 的直接上傳。這項受控隔離測試不授權任何正式 Migration。

- **2026-10-26 M3 WikiLink create-only 原子寫入接線（本輪候選）**：沿用 Production/Sandbox 既有 `002` 的 `save_knowledge_note()` SECURITY INVOKER／Owner-RLS RPC，對**新增且含作用中 WikiLink** 的單篇 Scratch Markdown 只傳 `p_id=null`，由單一 SQL 交易同時 INSERT `knowledge_notes` 與 `knowledge_links`；無連結筆記仍使用原 create-only POST。RPC 參數的 `p_links` 必須由當次重讀的 Markdown AST 提取，最多 80 個，不能由外部單獨指定。寫入後透過 RLS 完整 Inventory、RPC 回傳 UUID 對照、SHA/revision、精確 backlink 數量與鍵值、最後一次 Inventory 重驗；任何失敗只能人工檢查，絕不重試或建立 Baseline。現有 MSI 手動 `--sandbox-scratch-create-only` 可重用相同路徑，**未在真正 Neon Sandbox 執行此新 RPC，也未接入正式 Vault／Production**。先前 #35 的 WikiLink **create** 禁令由這項候選解除；既有筆記的 WikiLink **update** 仍拒絕，待另外有 CAS + 同交易維護連結的正式設計／驗收，絕不偷用無版本條件的舊 RPC 更新既有筆記。

## M4 Incoming 隔離預演與固定 Sandbox 讀取（2026-10-24）

- **2026-10-26 M4/M5 Incoming 跨程序暫存副本重驗候選（依賴 PR #42）**：M4 手動 Incoming 在新建單篇遠端副本（或含本地衝突副本）後，於同一隨機 OS 暫存目錄額外排他寫入並 fsync 一份 `incoming-receipt.json`，只記錄 slug、決策、兩端 SHA 與遠端 revision，不含 JWT 或 Markdown。新增 MSI 本機唯讀入口 `scripts/obsidian-m4-sandbox-verify-receipt.ts --sandbox-scratch-verify-incoming-only`，由 stdin 傳入先前命令印出的私人 receipt 路徑，在**另一個 Node 程序**重新驗證該目錄內遠端及可選本地副本的完整位元組與 SHA；缺件或改動拒絕，保留人工檢視用途。**這只驗本機暫存副本與自述 metadata 相符，不具 MAC、可信寫入先後、Neon 重新 GET 或 Vault 現況證明，絕不可轉換為成功 Baseline、M6 真實 E2E 或正式同步授權**。路徑需本人保護與清理；本輪僅模擬 HTTP＋真正 OS Scratch + 新 Node 子程序驗證。

- **2026-10-26 M4→M5 真正 Owner-RLS 來源新鮮度預檢（候選，未做真實 GET）**：既有跨程序 `incoming-receipt.json` 唯讀驗證現在可選擇 MSI 手動 `scripts/obsidian-m4-sandbox-verify-receipt.ts --sandbox-scratch-verify-incoming-live-readonly`，由 stdin 一次帶入 `{receiptPath,sandboxOwnerJwt,typedConfirmation:"VERIFY SANDBOX INCOMING <slug>"}`；只允許固定 Integration Sandbox、短效 Owner JWT、本人 `blog_admins` RLS 驗證、完整清單與同一篇精確 SHA/revision 的 GET，完成後**再次驗證**暫存遠端副本、可選本地衝突副本及 receipt 未遭修改。任何版本變動、撤銷 Owner、無授權或暫存檔遭修改都停止，不能自動重試、寫入 Baseline 或處理原 Vault。這是 M4 實際落盤副本到 M5 恢復決策的唯讀接線，**不能憑自述 receipt 證明歷史同步成功**，也不驗證真實 Vault 此刻內容。只用模擬 Owner GET 與隔離 OS 暫存檔測試；**真正 MSI Sandbox GET/E2E 仍需 Owner 當次個別授權**，不得把此候選當成已驗收。

- **2026-10-26 M4/M5 兩端衝突實體副本候選**：原有 M4 MSI 人工單篇管線可**選擇性**加上 `localMarkdown`（只允許 `conflict`，需恰符審查的 `expectedLocalSha`，限 250 KiB）；先在記憶體驗 SHA，再以原有固定 Sandbox Owner-RLS GET 驗證並取得遠端 Markdown。成功時同一個全新 OS 暫存 Incoming 內以排他 `wx` + `fsync` + 回讀 SHA 建立 `<slug>.md`（遠端）及 `<slug>--local.md`（使用者透過 stdin 提供的本地快照）；任一寫入失敗清除本次暫存目錄。既有無 `localMarkdown` 的單篇流程不變；**不讀寫真實 Vault、不存 Baseline、不推斷雙方勝者，不能證明提交快照後 Vault 未再次變更**。目前僅合成 HTTP + 真實 OS 暫存檔離線驗證；仍無真實 Owner JWT／Neon GET 驗收。

- **2026-10-26 M2→MSI Incoming 直接交接候選**：M2 已合併的單篇「下載／保留兩份」交接 JSON，現在可原封不動當作 MSI M4 stdin 請求的 `handoff` 物件，不必人工摘錄 SHA／Revision 到 `decision`；舊 `decision` 輸入維持相容。入口仍需要短效 Sandbox Owner JWT 與另一個逐篇 `SAVE SANDBOX INCOMING <slug>` 確認，嚴格拒絕多餘欄位及錯誤格式，再經原本 Owner-RLS GET、版本重驗、獨立檔案回讀驗證。以 M2 JSON→M4 MSI parser→模擬 Owner GET→實際 OS 暫存 Incoming 位元組的離線整合測試驗證；**尚未使用真實 Neon Sandbox Owner JWT/GET，沒有修改任何 Vault 或 Baseline**。
- MSI 本人手動執行示意（下載的 JSON 僅為未受信任審查提示；私密 SHA/slug 不要寫入日誌；操作前須另外取得 Owner 對這篇的授權，不應在無授權時執行）：

```powershell
$handoff = Get-Content -LiteralPath 'C:\Temp\naosledge-m4-incoming-note.json' -Raw -Encoding utf8 | ConvertFrom-Json
$approval = Read-Host 'Type SAVE SANDBOX INCOMING <slug>'
$secret = Read-Host 'Short-lived Sandbox OWNER JWT' -AsSecureString
try {
  @{ sandboxOwnerJwt = [System.Net.NetworkCredential]::new('', $secret).Password
     handoff = $handoff; typedConfirmation = $approval } |
    ConvertTo-Json -Depth 8 -Compress |
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-m4-sandbox-manual-incoming.ts --sandbox-scratch-incoming-only
} finally {
  Remove-Variable handoff,approval,secret -ErrorAction SilentlyContinue
}
```
- 上述命令只在本人持有可用的短效 Sandbox Owner JWT 且**本次個別批准真正 GET/副本下載**後才使用；本輪沒有執行。僅顯示生成的私人暫存 Incoming 路徑，不寫真實 Vault、不持久化 Baseline。使用後由本人清理下載 JSON 及 Incoming 副本。


- **2026-10-26 M2 → M4 瀏覽器選擇交接（PR #40 已合併 main）**：真正 MSI M1/M2 唯讀 JSON 匯入私有審查頁後，只有本人逐篇選「預定下載」（`review-download`／`review-missing-local`）或衝突「保留兩份」（`conflict`），且本機覆蓋完整、遠端 Revision 為真正 Sandbox 使用的 64 位 SHA 時，才顯示「匯出單篇 Incoming 交接 JSON」。瀏覽器只用 Blob 下載**一篇**僅含 slug／choice／兩端 SHA／revision 的六欄 `SyncDecision`，外層帶 `naosledge.m4.sandbox-incoming-intent.v1` 格式；無 JWT、正文、原稿路徑、目的地、授權或自動操作。MSI 可直接把完整交接 JSON 作為 `handoff` 送入既有 `obsidian-m4-sandbox-manual-incoming.ts --sandbox-scratch-incoming-only` stdin（舊版另支援抽取 `JSON.decision`），**另外**輸入短效 Sandbox Owner JWT 及逐篇 `SAVE SANDBOX INCOMING <slug>`；M4 會再次 Owner-RLS GET、比對版本，成功只寫新 OS 暫存 Incoming，**原稿及 Baseline 不變**。使用者應在本機保護並清除含私人筆記識別資訊的匯出檔。Node 定向測試與實體 Chrome 檔案下載測試使用**合成** M1 資料，並未執行真正 Neon GET、原稿存取或 Sandbox 寫入；實際 MSI／Owner 身分下載驗收仍需另行核准。以下為**舊版 decision 手動組合示例**，上方 `handoff` 整包交接為建議方式（**只供本人核准後在 MSI 執行，絕不可將 JWT 貼進檔案／argv／日誌**）：

```powershell
$handoffPath = 'C:\\Users\\Naos\\Downloads\\naosledge-m4-incoming-<slug>.json'
$handoff = Get-Content -LiteralPath $handoffPath -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
if ($handoff.Count -ne 2 -or $handoff.format -ne 'naosledge.m4.sandbox-incoming-intent.v1') { throw 'Not an M4 Incoming handoff' }
$typed = Read-Host ("Type SAVE SANDBOX INCOMING " + $handoff.decision.slug)
$secret = Read-Host 'Short-lived Sandbox OWNER JWT' -AsSecureString
try {
  @{ sandboxOwnerJwt = [System.Net.NetworkCredential]::new('', $secret).Password
     decision = $handoff.decision
     typedConfirmation = $typed } |
    ConvertTo-Json -Compress -Depth 6 |
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-m4-sandbox-manual-incoming.ts --sandbox-scratch-incoming-only
} finally {
  Remove-Variable secret,typed,handoff -ErrorAction SilentlyContinue
}
```

- **2026-10-26 M4 暫存副本落盤驗證（PR #36 追加）**：對經 Owner-RLS 唯讀驗證的單篇 Markdown，於全新隨機 OS 暫存 Incoming 以 `wx`／私人檔案權限建立後，先對已開啟檔案 `fsync`、關閉，再重新讀取實際檔案位元組計算 SHA-256；只有與事前審核的遠端 SHA 完全一致才回傳成功收據。寫入、同步、關閉、回讀或 SHA 不符一律清理本次新建的 Incoming 目錄並回報失敗。這僅降低暫存副本部分寫入或落盤錯誤被誤報成功的風險，**不保證斷電後目錄持久性**、不認證真正 MSI／Neon E2E、不修改 Vault 或 Baseline、也不構成自動同步授權。

- **2026-10-26 M4 低階 Incoming 決策一致性守門**：在 `stageNeonSandboxIncoming()` 本身驗證單篇 M2 `SyncDecision` 必須恰含 6 個規定欄位、合法本地 SHA／遠端 SHA／revision，`review-missing-local` 必須本地 SHA 為 null，`review-download`／`conflict` 必須有與遠端不同的本地 SHA。拒絕偽造衝突、已相同版本、遺漏本地版本與夾帶任意目的地，且在 Owner GET 或建立 Incoming 前拒絕；不再僅倚賴 MSI CLI 已做的同型驗證。新增紅燈→綠燈模擬 HTTP／Scratch 回歸，未執行真正 Neon GET 或任何 Vault 寫入，也未核准正式同步。

- **2026-10-25 M4 MSI 人工暫存下載入口**：新增 `scripts/obsidian-m4-sandbox-manual-incoming.ts --sandbox-scratch-incoming-only`，僅在 MSI 以人工管線輸入短效 Sandbox Owner JWT、單篇 M2 `SyncDecision`（完整兩端 SHA／Revision）、`SAVE SANDBOX INCOMING <slug>` 確認後，呼叫原有固定 Sandbox 逐篇 GET 與驗證。輸入長度限制、拒絕目的地／任意多餘欄位／非法方向、禁止讀寫 Obsidian 原稿；成功僅回報私人 OS 暫存 Incoming 路徑，不建立 Baseline，也不刪除。須由 Owner 自行保護與清理暫存副本；目前只通過離線模擬，不表示真人 JWT/Neon GET 成功。這是手動驗收工具，不是正式 UI 同步執行器。

- **PR #30 低階功能（尚未真人驗收）**：`fetchVerifiedNeonSandboxMarkdown()` 在固定 Neon Sandbox 以短效 Owner JWT 驗證 `blog_admins` 和完整清單，再透過單篇 GET 比對可攜 Markdown SHA-256 與遠端 revision；清單或版本不符即拒絕。`stageNeonSandboxIncoming()` 僅在人工逐篇輸入 `SAVE SANDBOX INCOMING <slug>` 後，於 OS per-user 暫存根目錄新建隨機 Incoming 目錄並以 `wx` 建立副本。只適用 `review-download`、`review-missing-local`、`conflict`；不提供任意目的地、不碰真實 Vault、不覆寫原稿、不更新 Baseline、不刪除。此前只有模擬 HTTP＋隨機暫存檔測試；本輪補上以下 MSI 人工入口，仍未完成真正 Neon GET 驗收或正式的私人暫存檔清理流程。

- `createDurableSyntheticObsidianWorkspace()` 另設**全新隨機 Scratch 下的 `incoming/`**；`preview().incomingConsents` 只針對 `review-download`、`review-missing-local`、`conflict` 提供逐篇亂數、10 分鐘有效確認碼。衝突是 **keep-both 的獨立 Incoming 副本**，不是允許既有 `approvedDownload()` 的覆寫。
- `approvedIncomingDownload()` **只有合成 Remote Map** 作為來源，對本次工廠建立的 `incoming/` 以排他 `wx` 建立唯一名稱的新 Markdown，拒絕危險 slug、舊 SHA/Revision、局部不同、偽造／重放／過期確認碼、被替換的 Incoming 目錄，失敗時不留下已建立的未確認副本。
- 成功下載僅表示「產生一份待人檢視的副本」：**不修改合成原稿、不修改或清理 Baseline、不自動刪除、不產生任何正式同步權限**。其他舊授權一律失效，下一篇需重新預覽。`tests/obsidian-m4-incoming-sandbox.test.mjs` 驗證新檔、衝突、過期版本、檔名、競態與預設拒絕。
- **仍未接入真實 NaosLedge、Neon 或 MSI Obsidian Vault**；`syntheticWorkspacePath` 僅供測試，絕不可把本工廠當正式寫入適配器。真實下載前需完成 Owner／Sandbox 驗收與獨立 Inbox 路徑安全設計。

## M5 Baseline 保留與合成成功證據（2026-10-24）

- **2026-10-26 M5 私人審查頁雙版本實際接線（候選）**：`/vault/sync` 增加完全在瀏覽器本機執行的 M4 Incoming 衝突比對。人工同時選取同一筆 Incoming 的 `incoming-receipt.json`、`<slug>.md`、`<slug>--local.md`，按 M4 實際產出格式、slug／檔名及兩個**完整 SHA-256** 驗證後，並排顯示兩份原始 Markdown 純文字；驗證失敗不顯示正文，重新選取會清除先前內容，支援人工清除。已用 M4 實際暫存三檔→M5 匯入及改檔拒絕進行 Node 整合回歸，另在 MSI localhost Chrome 驗證三檔匯入、並排呈現、竄改拒絕、RWD，未產生外部網路請求；仍未接觸真正 Neon 或 Vault。**這是供 Owner 人工比較的前端候選功能，無瀏覽器網路請求、無 JWT、無自動合併/覆寫、無 Baseline 寫入；收據只自述 M4 暫存位元組，不能證明真正 Neon 當前狀態或曾完成可信同步。真正 Owner-RLS Sandbox E2E 及跨程序可信 Baseline 仍未完成。**
- **2026-10-26 M3→M5 跨程序交接候選（本分支）**：M3 MSI 單篇 create/update 僅在其原有 Owner-RLS POST/PATCH+事後 GET／索引驗證**已成功返回**時，將 SHA／Revision／方向保存至新建 OS Scratch `transfer-witness.json`（嚴格單篇、`wx`/fsync/回讀，**不含 JWT／Markdown**）；有獨立 MSI 手動 `--sandbox-scratch-reverify-m3-witness-only` 入口，重新以 stdin 的當前 Scratch Markdown SHA 與短效 Sandbox Owner JWT 執行 Owner-RLS 完整清單及單篇 GET 後再核對檔案。遺失／遭竄改／遠端更新／非 Owner 均拒絕；**自陳式 OS 暫存收據可偽造，不能證明實際 Vault 原稿、授權行為或安全事件順序，也不是可信正式 Baseline。** 本分支只跑離線 HTTP 模擬＋真實 OS 檔案驗證，不會自動寫入 Baseline、啟動 Sandbox POST/PATCH、認證、Production 或 Vault。真正 Sandbox 寫入驗收另需當輪 Owner 授權；M5 可信來源證據及正式 Baseline 仍未完成。

- `lib/obsidian-durable-write-sandbox.ts` 在**當次隨機 Scratch** 新增 `baseline-journal/`：合成環境每次已批准的上傳、下載或復原，在再次確認兩端 SHA 相同、遠端 revision 未變後，才以新 UUID `.json` **追加**同步成功證據（無 Markdown 正文或憑證）；寫檔前先暫存、再次比對、提交並同步檔案與目錄（Windows 目錄同步僅 best-effort）。無任何正式 Obsidian／Neon 路徑參數，不能用於正式同步。
- `listConfirmedSyntheticBaselines()` 僅供同一 Scratch 唯讀檢驗並嚴格拒絕遭改動或不合法的 checkpoint；**不會將檔案自動匯入 Baseline、重建現有記憶體狀態或觸發同步**。
- 合成 Incoming 僅產生待檢視副本，**不記錄成功同步、不更新 Baseline**。若人工批准的 Restore 導致本機與遠端仍不相同，**保留既有 Baseline** 供重新比較，不得以 `baseline.delete()` 偷清除衝突依據；遠端也一致且重新驗證時才追加新證據。
- `tests/obsidian-m5-baseline-journal-sandbox.test.mjs` 驗證成功附加、一次性授權、復原時衝突保留、不完整或偽造日誌拒絕、Incoming 不變動等。**仍不是正式 Baseline 資料庫**：Scratch 由工廠銷毀且沒有正式持久載入／遷移設計，真正 MSI／Neon Sandbox E2E 與持續保留策略仍待完成。
- **2026-10-24 本輪 M5 唯讀內容比較**：`compareSyntheticConflict()` 僅讀同一隨機 Scratch 中的合成雙邊版本，先確認 M1 決策為 `conflict`、SHA + revision 未過期，並在輸出前再次驗證；行比較保留變更前後脈絡，最多約 86 行、每行最多 160 個 Unicode 字元，額外標註省略行與僅換行格式差異。比較不會發出授權碼、合併、寫入、刪除或更動 Baseline，也不將 Markdown 放入 CI。測試涵蓋一般衝突、版本過期、非衝突、長文節流及 CRLF/LF。**此為合成比較原型，不是實際私人 Vault UI 或 Neon 資料傳輸。**
- **2026-10-24 M5 重載預檢**：`inspectSyntheticBaselineReload()` 僅在同一隨機 Scratch 重新讀取格式合格的 checkpoint，並與當下合成 Local SHA、Remote SHA/revision 及既有記憶體 Baseline 交叉核對；可標記雙邊吻合、版本過期、Baseline 不同與多筆歷史歧義。UUID 檔名及時間戳**不能作為可信寫入順序**；多筆同名紀錄不選最新，檔案損壞或讀取中變動就拒絕。即使雙邊吻合，日誌也沒有可跨程序認證的簽章／交易順序，因此**只是人工驗證候選、不能自動匯入 Baseline、授權寫入、覆寫、刪除或同步**。2026-10-24 再補上**重載結尾重新讀取每份 checkpoint**，不僅比對檔名清單，還拒絕檢查期間同名 JSON 被替換成另一份格式合法但內容不同的紀錄；新增確定性競態測試。M5 專項測試目前 16 項通過（本機驗證）；仍需另設可信交易格式與真正跨程序重啟 E2E，才能設計正式持久載入。
- **2026-10-24 M5 重載末段競態保護**：重新檢查 Journal 後、回傳唯讀預檢結果前，也再次比對所有單份證據筆記的 Local SHA、Remote SHA/Revision 與記憶體 Baseline；防止先前逐篇驗證通過，卻在最後日誌檢查期間變更來源而回傳過期的「兩端吻合」。新增本機、遠端和 Baseline 三種確定性末段競態測試；這不具備真正跨程序交易鎖，仍不授權自動載入或同步。

- **2026-10-24 M5 合成 Checkpoint 格式拒絕**：唯讀日誌讀取器現在只接受 `randomUUID()` 產生的標準小寫 UUID v4 檔名（不再接受任意 36 字元十六進位／連字號排列），並驗證證據 slug 長度為 3–120 字元；在任何 Baseline 恢復預覽之前拒絕造假格式。新增先失敗後修正通過的合成 Scratch 回歸案例，M5 專項測試共 17 項通過。**這仍不是對持久日誌的身分認證、可信排序或正式同步授權**。

- **2026-10-26 M5 唯讀重載缺少證據防誤判（候選 PR）**：原本日誌為空，但記憶體 Baseline 有筆記時，`inspectSyntheticBaselineReload()` 會回傳 `notes=[]`，未顯示缺少成功 checkpoint。現在把每筆未出現在日誌的記憶體 Baseline 列為 `missing-journal-evidence`（`checkpointCount=0`、`checkpointId=null`）；即使雙邊現有 SHA 相同，也**不代表曾完成經批准同步**。同時在最後重新檢查所有記憶體 Baseline 的 slug／SHA 集合，拒絕檢查期間新增或改動的無日誌項目；新增無日誌、混合日誌與最終競態的確定性回歸測試。這是隔離 Scratch 的 read-only fail-closed 修正，**不是跨程序可信重載、真正持久化、簽章、正式資料寫入或 M6 真實 E2E**。
- **2026-10-26 M5 checkpoint 時間戳嚴格驗證（同一候選 PR）**：先失敗後修正的 Scratch 測試證實，原本只使用 `Date.parse()` 會把 `"0"`、RFC 文字日期和缺少毫秒的時間戳當成合格 M5 證據。現在唯讀 Journal 僅接受 writer 實際產出的 `YYYY-MM-DDTHH:mm:ss.sssZ` 標準 UTC 時間，並以 ISO 往返驗證拒絕日曆溢位或非標準輸入；不改變合成 checkpoint 寫入與 Baseline 狀態。時間戳**仍不可用來證明日誌身分或選擇多筆歷史順序**，真正跨程序可信恢復／正式資料層接線仍未完成。

- **2026-10-26 M5 未建檔來源覆蓋驗證（同一候選 PR）**：修正 `inspectSyntheticBaselineReload()` 原本只列出 Journal／記憶體 Baseline 已知 slug，導致新出現、尚無任何同步證據的本地或遠端合成筆記在重載報告中直接消失。現在先做完整合成 Scratch 本地指紋與 Remote Map 清單，將沒有 Checkpoint 的來源列為 `missing-journal-evidence`；末段再次比對整份本地 SHA／遠端 SHA+Revision 清單，新增、修改或移除即拒絕過期預檢，未索引的本地檔案亦 fail-closed。M5、M6 定向回歸已更新；**仍僅限合成 Scratch 的唯讀預檢，不會自動匯入 Baseline、確認同步成功、存取真實 Vault 或對 Neon 寫入**。

- **2026-10-26 M5 合成筆記根目錄覆蓋漏洞（同一候選 PR）**：新增先失敗後通過的回歸測試：共用的 Vault 唯讀掃描器會合理忽略 `.obsidian/` 設定目錄，但 M5 的隨機 Scratch `notes/` 根目錄並不是 Vault，不應允許這個排除規則隱藏額外 Markdown。`inspectSyntheticBaselineReload()` 現在在初次及最後清單驗證時拒絕出現 `.obsidian` 的合成 notes 根目錄，避免在不完整來源下回報 `matches-current-pair`。只修改隔離 Scratch 的唯讀預檢，不更動正式 Vault 掃描規則或授權寫入；M5 跨程序可信恢復與 M6 真實 E2E 仍未完成。

- **2026-10-26 M5 Checkpoint 重複鍵與非標準 JSON 拒絕（同一候選 PR）**：先失敗後通過的回歸測試發現 `JSON.parse()` 對同一欄位出現兩次採最後值，讓含互相矛盾 `sha256` 的合成成功證據通過原本的值／欄位檢查。`listConfirmedSyntheticBaselines()` 現在要求檔案位元組與 writer 使用的 `JSON.stringify(item)` 完全相同，拒絕重複鍵、非標準空白及不同序列化表示；合法原始 Checkpoint 可照常唯讀。**此格式正規化不是身分認證、MAC、可信排序或跨程序持久恢復**，沒有任何正式 Vault／Neon 寫入、Baseline 匯入或 M6 真實 Sandbox E2E。

## M6 合成跨階段安全回歸（2026-10-24，非真實 E2E）

- `tests/obsidian-m6-synthetic-cross-stage.test.mjs` 把既有 M1 唯讀組合器、M2 審查意圖、M3 合成上傳、M4 Incoming 副本與 M5 唯讀證據檢查串成**單一 Scratch 隔離測試**；模擬 Remote 只存在記憶體，沒有真正 Neon HTTP、Owner JWT、Production、真實 Obsidian Vault 或傳輸授權。
- 整合回歸檢查：M2 選擇不產生寫入；逐篇批准後僅上傳單篇合成筆記；遠端筆記及雙改衝突只在 Incoming 新建副本，不覆寫原稿；Incoming 不更新 Baseline；只有已重新確認兩端內容一致的上傳才留下合成 Checkpoint。
- 另外覆蓋上傳前遠端競態、Incoming 前本機競態、未掃描的巢狀 Markdown、不完整的遠端清單，並確認全部 fail-closed、無刪除或不當成功證據。原有跨階段測試 **4 PASS、0 FAIL**。
- **2026-10-24 本輪追加 M1／M6 離線 HTTP 鏈條**：`fetchVerifiedNeonSandboxOwnerFingerprints()` 強制同一 Sandbox JWT 先通過 `blog_admins` Owner-RLS 自身授權 GET，再取得 `knowledge_notes` 完整唯讀清單；MSI 手動入口改用該不可分割封裝。新增 `tests/obsidian-m6-owner-rls-readonly-chain.test.mjs`（3 項）以假 JWT、模擬 HTTP 與隨機 Scratch 驗證：Owner 成功才產生 M2 非執行選擇；非 Owner 的 `200 + []` 在資料 GET 前拒絕；401／503／截斷 JSON／網路斷線均 fail-closed，無實際傳輸、Baseline 或筆記寫入。**沒有真實 Sandbox Owner JWT、沒有 Neon 網路連線、沒有真實 MSI Vault 操作**，不可宣稱 M1 真實 Owner-RLS 或 M6 E2E 已完成。
- 真正 M6 Sandbox Auth／RLS／API＋MSI E2E、網路失敗復原及資料清理證據仍待完成。

## M1 唯讀整合（本次提供的原型程式碼）

- 核心檔案：`lib/obsidian-manual-sync-review.ts`，使用既有 `planObsidianReconciliation()`，不修改原本分類邏輯。
- 預期由已授權呼叫端明確提供 `readLocal()`、`readRemote()` 和 `baseline`。兩個 reader 可以接已有 `readObsidianLocalManifest()` 和 `fetchNeonSandboxFingerprints()`，但**本模組自己沒有任意目錄路徑、Neon URL、JWT 儲存或寫入入口**。
- 遠端讀取結果必須是 **Neon Sandbox、Owner RLS、GET-only、fullInventory=true**，並且回報筆數與指紋陣列相符，最多 20 筆；若為 401/403、網路錯誤、超量或不完整，**絕不能當作空清單**。
- 本機不支援的 `.md` 檔名與未掃描資料夾，回報 `partial-local-coverage`、非零筆數，不能假裝全 Vault 都已列入。注意既有掃描器的 `directoriesNotScanned` 也可能包含正常的 `.obsidian/`；下一步應精準區分設定資料夾與真正未索引的巢狀筆記，而不是粗暴忽略。
- 輸出僅包含安全 slug、SHA/revision 指紋、分類、計數與 `writeAllowed=false`、`deleteAllowed=false`。**不要把含私人筆記識別資訊的預覽直接放到公開日誌、CI 或匿名頁面。**
- 不持久化 `baseline`。沒有 Baseline 時「同名內容不同」一定視為 conflict，不能推斷哪邊是最新版本。
- `both-removed` 表示兩邊都不存在但 Baseline 曾有資料：只保留檢視結果，不刪除 Baseline，也不自動建立任何刪除計畫。

## 既有程式重用與技術限制

| 既有程式 | 本次的用途 | 邊界 |
| --- | --- | --- |
| `lib/obsidian-local-manifest.ts` | MSI 根目錄 `.md` 唯讀 SHA-256 | 只支援安全英文 slug、250 KiB、最多 500 篇；中文檔名/子資料夾會單獨標記 |
| `lib/obsidian-neon-sandbox-readonly.ts` | 僅固定已核准的 Neon Sandbox Owner-RLS GET 指紋 | 最多 20 篇；超量和不完整即停止；不能改用 Production JWT |
| `lib/obsidian-sync-plan.ts` | 區分 unchanged/upload/download/conflict/missing/both-removed | 純函式，無資料庫和檔案 IO，沒有同步核准權限 |
| `lib/obsidian-markdown.ts` | 共用 .md 序列化格式 | 本機 SHA 和遠端 SHA 必須來自相同可攜位元組表示；轉換格式差異須標為人工檢查 |
| `lib/obsidian-sync-sandbox.ts` | 參考逐篇確認/過期版本拒絕的合成測試 | 原有合成覆寫不能直接用於正式 MSI Vault |

## 測試與下一個開發動作

1. **已完成 MSI 原專案接線驗收的離線部分**：M1 的 19 項定向測試包含完整 Reader 鏈條（真實 FS 掃描＋真實 Neon GET Reader，使用合成 HTTP 回應），18 PASS、1 項非 Windows 專用拒絕測試依設計 SKIP。仍不代表已用真實 Owner JWT 呼叫 Neon Sandbox。
2. **已在正常的 OpenChatX 專案權限下建立 `feat/obsidian-manual-sync-review-20261023`** 並套用 M1 原型與測試，與 PR #25 的加密研究分支隔離；前次 Git 建分支拒絕在重新核對後以同一工具正常執行成功。
3. 固定 MSI 接線函式已加入正式產品分支並通過靜態保護測試；**真正 MSI GUI 註冊讀取和 Neon Owner JWT／GET 尚未直接以 M1 組合器執行**。下一步要以審查過的安全入口與經授權 Sandbox 身分執行唯讀驗收，不能使用 Production JWT。
4. M1 已合併 `main`，但不得把 GitHub CI 或合併視為真正的 Owner Sandbox GET 驗收。使用者已確認一般開發不需要獨立 QA，不再因此阻擋 M2/M3；M2 合成 UI 及 MSI 瀏覽器驗收已完成於 PR #27，但真實 Vault/Production 操作及真正上下載仍屬後續受控工作。

## 暫停擴充項目

暫不擴充 TPM/DPAPI 生產金鑰保護、企業級 AES 備份、強制斷電實驗、背景 Cron、全面自動覆寫；保留 PR #21–25 的既有研究成果供後續參考，不設為 M1–M4 功能前置條件。

## M1 獨立整合包 v2（2026-10-23）

- 加入 `lib/obsidian-manual-sync-approved-msi.ts`：只有 MSI Windows 裝置、正式已核准 Vault 註冊一致，才允許建立**一次性唯讀預覽**；只使用固定 Neon Sandbox 分支、固定路徑的原有 RLS GET Reader，沒有 CLI、UI、排程、寫入或憑證保存。
- 加入 `tests/obsidian-manual-sync-approved-msi.test.mjs`：在非 MSI 環境驗證裝置拒絕和純靜態固定讀取接線。**沒有冒充在 MSI 上測試成功**。
- 加入 `tests/obsidian-manual-sync-synthetic-integration.test.mjs`：在容器上使用真實 Node `fs` 掃描合成 `.md`，遠端則使用**模擬的 Owner-RLS 正式形狀清單**；驗證上／下傳預覽、雙改衝突、中文檔名／未掃描資料夾警示、遠端異常不當作刪除。
- M1 baseline 先驗證再讀取任何 Reader；資料不合法立即拒絕。
- v2 獨立測試 17/17 已通過；後續經允許的 Git 分支建立已成功，**已於 MSI 原始碼整合並完成 19 項定向測試（18 PASS／1 OS 特定 SKIP）**，實際 Neon Sandbox Owner GET、獨立 QA 與 Production 同步仍未執行。
