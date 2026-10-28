/**
 * Real MSI Chrome UI rehearsal for the actual M2 component.
 * Transient local fixture only; no real login, Vault access, Neon network,
 * persistent approvals, uploads or production deployment.
 */
import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir,readFile,rm,unlink,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import path from "node:path";
import os from "node:os";
import {chromium} from "playwright-core";
import {makeSyntheticM2Preview} from "../lib/obsidian-m2-synthetic-fixture.ts";
import {
  parseManualM2Handoff,serializeManualM2Handoff,
  MANUAL_M4_INCOMING_INTENT_FORMAT,MANUAL_M3_UPLOAD_INTENT_FORMAT,
  parseManualM3UploadIntent,
} from "../lib/obsidian-m2-review-choices.ts";
import {saveManualM2Handoff} from "./obsidian-msi-manual-preview.ts";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const require=createRequire(import.meta.url);
// Worktrees can reuse the parent repository's installed Next.js without
// a local node_modules junction. Resolve the actual package, not cwd.
const nextBin=path.join(path.dirname(require.resolve("next/package.json")),
  "dist","bin","next");
const fixture=path.join(root,"app","m2-sync-local-fixture");
const nextEnvPath=path.join(root,"next-env.d.ts");
const previousNextEnv=await readFile(nextEnvPath,"utf8");
if(existsSync(fixture))throw Error("Refusing to overwrite an existing M2 fixture");
const candidates=[
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft Edge\\Application\\msedge.exe",
];
const executablePath=candidates.find(existsSync);
if(!executablePath)throw Error("MSI Chrome/Edge unavailable");

const pageSource=`import "@/app/vault/vault.css";
import "@/app/vault/vault-sync.css";
import VaultManualSyncReview from "@/components/vault-manual-sync-review";
import {makeSyntheticM2Preview} from "@/lib/obsidian-m2-synthetic-fixture";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false}};
export default async function M2LocalFixture({searchParams}){
  const {coverage,mode}=await searchParams;
  const preview=await makeSyntheticM2Preview();
  const shown=coverage==="partial"?{
    ...preview,previewStatus:"partial-local-coverage" as const,
    inventory:{
      ...preview.inventory,localUnsupportedMarkdown:2,
      localDirectoriesNotScanned:1,localCoverageNeedsReview:true,
    },
  }:preview;
  if(mode==="m7-verified")return <VaultManualSyncReview m7ProductionReadiness={{
    state:"verified",remoteNotes:2,remoteFullInventoryRead:false,
    noteBodiesRead:false,comparisonPerformed:false,transferAllowed:false,baselineSaved:false,
  }}/>;
  if(mode==="m7-unavailable")return <VaultManualSyncReview m7ProductionReadiness={{
    state:"unavailable",
  }}/>;
  return mode==="empty"?<VaultManualSyncReview/>:<VaultManualSyncReview preview={shown}/>;
}
`;

async function freePort(){
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      server.close(()=>resolve(address.port));
    });
  });
}

let server,browser;
const screenshots=path.join(os.tmpdir(),"naosledge-m2-offline-visual");
try{
  await mkdir(fixture,{recursive:true});
  await writeFile(path.join(fixture,"page.tsx"),pageSource,"utf8");
  const port=await freePort(),origin=`http://localhost:${port}`;
  server=spawn(process.execPath,[
    nextBin,
    "dev","--webpack","--hostname","localhost","--port",String(port),
  ],{
    cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"],
    env:{
      ...process.env,NODE_ENV:"development",
      NAOSLEDGE_BACKEND:"neon",NEXT_PUBLIC_NAOSLEDGE_BACKEND:"neon",
      NAOSLEDGE_NEON_BRANCH_ID:"br-quiet-sunset-b4xx4pnx",
      NEON_AUTH_BASE_URL:"https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth",
      NEON_DATA_API_URL:"https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1",
      NEON_AUTH_COOKIE_SECRET:randomBytes(48).toString("base64url"),
      NEXT_PUBLIC_SITE_URL:origin,
    },
  });
  let ready=false;
  for(let i=0;i<140;i++){
    if(server.exitCode!==null)throw Error("Local Next test server exited");
    try{
      const response=await fetch(origin+"/m2-sync-local-fixture",{signal:AbortSignal.timeout(1200)});
      if(response.ok){ready=true;break;}
    }catch{}
    await delay(400);
  }
  if(!ready)throw Error("M2 local browser fixture did not become ready");
  browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox"]});
  const context=await browser.newContext({viewport:{width:375,height:812}});
  const page=await context.newPage();
  const jsErrors=[],remoteRequests=[];
  page.on("pageerror",error=>jsErrors.push(String(error.message).slice(0,150)));
  page.on("request",request=>{
    const url=request.url();
    if(!url.startsWith(origin+"/")&&!url.startsWith("data:")&&!url.startsWith("blob:"))
      remoteRequests.push("unexpected-external-request");
  });
  // M7 Production readiness panel is only a rendered synthetic STATUS here.
  // It must never turn a count into a transfer or M2 review authorization.
  await page.goto(origin+"/m2-sync-local-fixture?mode=m7-verified",
    {waitUntil:"networkidle"});
  const readiness=page.getByRole("status",{name:"M7 正式環境唯讀預檢"});
  assert.match(await readiness.innerText(),/Neon Production 目前有 2 篇本人私人筆記/);
  assert.match(await readiness.innerText(),/未取得 MSI Vault 完整比對/);
  assert.equal(await page.locator(".vault-sync-note").count(),0);
  assert.equal(await page.getByRole("button",{name:"預定上傳"}).count(),0);
  await page.goto(origin+"/m2-sync-local-fixture?mode=m7-unavailable",
    {waitUntil:"networkidle"});
  const blocked=page.getByRole("alert",{name:"M7 正式環境唯讀預檢未完成"});
  assert.match(await blocked.innerText(),/請勿把此狀態視為空資料庫或同步成功/);
  assert.equal(await page.locator(".vault-sync-note").count(),0);
  console.log("PASS M7 synthetic web status visible; no implied Production transfers");

  // Exercise the production entry state: no synthetic notes until the Owner
  // explicitly imports a valid MSI export file. This is still a synthetic
  // exporter fixture, NOT an authenticated Neon Sandbox acceptance.
  await page.goto(origin+"/m2-sync-local-fixture?mode=empty",{waitUntil:"networkidle"});
  assert.ok(await page.getByText("等待 MSI 唯讀快照").isVisible());
  assert.equal(await page.locator(".vault-sync-note").count(),0);
  assert.ok(await page.getByText("尚未匯入 MSI 唯讀快照").isVisible());
  const exported=await saveManualM2Handoff(await makeSyntheticM2Preview());
  try{
    await page.locator("#vault-sync-handoff-file").setInputFiles(exported);
    await page.getByText("MSI 手動匯入 · 唯讀快照")
      .waitFor({state:"visible",timeout:15_000});
    assert.equal(await page.locator(".vault-sync-note").count(),7);
    assert.ok(await page.getByText("遠端版本",{exact:true}).first().isVisible());
    const createAction=page.getByRole("group",{name:"local-new 的審查意圖"});
    await createAction.getByRole("button",{name:"預定上傳"}).click();
    const [uploadHandoff]=await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button",{name:"local-new 的 M3 上傳交接 JSON"}).click(),
    ]);
    assert.equal(uploadHandoff.suggestedFilename(),"naosledge-m3-upload-local-new.json");
    const uploadFile=JSON.parse(await readFile(await uploadHandoff.path(),"utf8"));
    assert.equal(uploadFile.format,MANUAL_M3_UPLOAD_INTENT_FORMAT);
    assert.equal(parseManualM3UploadIntent(uploadFile).choice,"review-missing-remote");
    assert.equal(Object.hasOwn(uploadFile,"sandboxOwnerJwt"),false);
    assert.equal(Object.hasOwn(uploadFile,"markdown"),false);
    await page.getByRole("button",{name:"移除私人快照"}).click();
    assert.equal(await page.locator(".vault-sync-note").count(),0);
    assert.ok(await page.getByText("等待 MSI 唯讀快照").isVisible());
  }finally{await unlink(exported).catch(()=>{});}
  console.log("PASS production-like empty state and physical MSI-style handoff export/import/clear");

  // The one-note path is always tested with a disposable in-memory M1
  // fixture; an explicitly supplied real MSI/Owner-RLS JSON replaces it.
  // No JWT enters the browser, and the page remains localhost-only.
  const realHandoff=process.env.NAOSLEDGE_M1M2_REAL_SANDBOX_HANDOFF;
  const oneNote=realHandoff?null:await previewManualObsidianSync({
    baseline:[],
    readLocal:async()=>({fingerprints:[],unsupportedMarkdownFiles:0,otherFiles:0,
      directoriesNotScanned:0,autoApplyAllowed:false}),
    readRemote:async()=>({
      fingerprints:[{slug:"m1m2-synthetic",sha256:"a".repeat(64),revision:"b".repeat(64)}],
      numberOfNotes:1,sandboxOnly:true,rlsEnforcedByDataApi:true,
      writeEnabled:false,fullInventory:true,
    }),
  });
  const testHandoff=oneNote?await saveManualM2Handoff(oneNote):null;
  const liveFile=realHandoff??testHandoff;
  try{
    if(!liveFile)throw Error("M2 handoff not provided");
    if(!path.isAbsolute(liveFile)||path.dirname(liveFile)!==os.tmpdir()||
       !path.basename(liveFile).startsWith("naosledge-m2-sandbox-readonly-")||
       !liveFile.endsWith(".json"))throw Error("Invalid temporary MSI handoff path");
    const real=parseManualM2Handoff(await readFile(liveFile,"utf8"));
    assert.equal(real.inventory.remoteFullInventory,true);
    assert.equal(real.inventory.localSupportedNotes,0);
    assert.equal(real.inventory.remoteNotes,1);
    assert.equal(real.summary["review-missing-local"],1);
    const row=real.decisions[0];
    assert.equal(row.choice,"review-missing-local");
    await page.goto(origin+"/m2-sync-local-fixture?mode=empty",{waitUntil:"networkidle"});
    await page.locator("#vault-sync-handoff-file").setInputFiles(liveFile);
    await page.getByText("MSI 手動匯入 · 唯讀快照")
      .waitFor({state:"visible",timeout:10_000});
    assert.equal(await page.locator(".vault-sync-note").count(),1);
    const action=page.getByRole("group",{name:row.slug+" 的審查意圖"});
    await action.getByRole("button",{name:"預定下載"}).click();
    const [incomingHandoff]=await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button",{name:row.slug+" 的 M4 Incoming 交接 JSON"}).click(),
    ]);
    assert.equal(incomingHandoff.suggestedFilename(),
      "naosledge-m4-incoming-"+row.slug+".json");
    const exportedIntent=JSON.parse(await readFile(await incomingHandoff.path(),"utf8"));
    assert.equal(exportedIntent.format,MANUAL_M4_INCOMING_INTENT_FORMAT);
    assert.deepEqual(exportedIntent.decision,{
      slug:row.slug,choice:row.choice,manualReview:true,
      expectedLocalSha:row.expectedLocalSha,
      expectedRemoteSha:row.expectedRemoteSha,
      expectedRemoteRevision:row.expectedRemoteRevision,
    });
    assert.equal(Object.hasOwn(exportedIntent,"sandboxOwnerJwt"),false);
    assert.equal(Object.hasOwn(exportedIntent,"typedConfirmation"),false);
    assert.equal(await action.getByRole("button",{name:"預定上傳"}).count(),0);
    assert.ok(await page.getByText("遠端版本",{exact:true}).first().isVisible());
    await page.getByRole("button",{name:"查看審查摘要"}).click();
    assert.match(await page.locator("#vault-sync-review-summary").innerText(),/預定下載 1/);
    await page.getByRole("button",{name:"移除私人快照"}).click();
    assert.equal(await page.locator(".vault-sync-note").count(),0);
    console.log(realHandoff?
      "PASS REAL Sandbox JWT/RLS-derived MSI JSON -> M2 browser import/review/clear":
      "PASS single-note synthetic MSI JSON -> M2 browser import/review/clear");
  }finally{if(testHandoff)await unlink(testHandoff).catch(()=>{}); }

  // M4 persisted receipt -> M5 browser-only conflict review; no real Neon,
  // Vault paths, authentication or Markdown sent to a server.
  const localVersion="## Synthetic local\r\nKeep local changes\r\n";
  const remoteVersion="## Synthetic remote\nKeep remote changes\n";
  const localSha=createHash("sha256").update(localVersion).digest("hex");
  const remoteSha=createHash("sha256").update(remoteVersion).digest("hex");
  const receipt=JSON.stringify({
    format:"naosledge.m4.incoming-copy.v1",slug:"offline-ui-conflict",
    choice:"conflict",remoteSha256:remoteSha,
    remoteRevision:"b".repeat(64),localSha256:localSha,
  });
  const conflictFiles=[
    {name:"incoming-receipt.json",mimeType:"application/json",buffer:Buffer.from(receipt)},
    {name:"offline-ui-conflict.md",mimeType:"text/markdown",buffer:Buffer.from(remoteVersion)},
    {name:"offline-ui-conflict--local.md",mimeType:"text/markdown",buffer:Buffer.from(localVersion)},
  ];
  await page.locator("#vault-sync-conflict-files").setInputFiles(conflictFiles);
  const conflictRegion=page.getByRole("region",{name:"offline-ui-conflict 的本機雙版本比對"});
  await conflictRegion.waitFor({state:"visible"});
  assert.match(await conflictRegion.innerText(),/Synthetic local/);
  assert.match(await conflictRegion.innerText(),/Synthetic remote/);
  await page.locator("#vault-sync-conflict-files").setInputFiles([
    conflictFiles[0],conflictFiles[1],
    {...conflictFiles[2],buffer:Buffer.from("## Tampered")},
  ]);
  await page.getByRole("alert")
    .getByText(/M4 收據、兩份原始 Markdown 副本或 SHA-256 不一致/)
    .waitFor({state:"visible",timeout:10_000});
  await conflictRegion.waitFor({state:"hidden",timeout:10_000});
  console.log("PASS M4 receipt -> M5 Chrome local pair verification, comparison and tamper refusal");

  for(const width of [375,768,1024,1440]){
    await page.setViewportSize({width,height:width<500?812:920});
    const response=await page.goto(origin+"/m2-sync-local-fixture",{waitUntil:"networkidle"});
    assert.equal(response.status(),200);
    assert.ok(await page.getByRole("heading",{name:/同步審查/}).isVisible());
    assert.ok(await page.getByText("目前不會執行同步。").isVisible());
    assert.equal(await page.locator(".vault-sync-note").count(),7);
    const metrics=await page.evaluate(()=>({
      doc:document.documentElement.scrollWidth,
      viewport:innerWidth,
      narrowButton:Math.min(...[...document.querySelectorAll(".vault-sync-options button")]
        .map(element=>element.getBoundingClientRect().height)),
    }));
    assert.ok(metrics.doc<=metrics.viewport+1,
      `Horizontal document overflow at ${width}px: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.narrowButton>=43.5,
      `Action controls too small at ${width}px: ${JSON.stringify(metrics)}`);
    console.log(`PASS M2 responsive ${width}px, no horizontal overflow and >=44px actions`);
  }
  await page.setViewportSize({width:1024,height:820});
  await page.goto(origin+"/m2-sync-local-fixture",{waitUntil:"networkidle"});

  // Invalid directions do not exist in the rendered group.
  const conflict=page.getByRole("group",{name:"typescript-notes 的審查意圖"});
  assert.equal(await conflict.getByRole("button",{name:"預定上傳"}).count(),0);
  assert.equal(await conflict.getByRole("button",{name:"預定下載"}).count(),0);
  const keep=conflict.getByRole("button",{name:"保留兩份"});
  await keep.focus();
  await page.keyboard.press("Enter");
  assert.equal(await keep.getAttribute("aria-pressed"),"true");
  console.log("PASS keyboard review: conflict only permits keep-both / skip");

  await page.getByRole("group",{name:"react-hooks 的審查意圖"})
    .getByRole("button",{name:"預定上傳"}).click();
  await page.getByRole("group",{name:"nextjs-routing 的審查意圖"})
    .getByRole("button",{name:"預定下載"}).click();
  await page.getByRole("group",{name:"remote-new 的審查意圖"})
    .getByRole("button",{name:"略過"}).click();
  await page.getByRole("button",{name:/查看審查摘要/}).click();
  const summary=page.locator("#vault-sync-review-summary");
  assert.ok(await summary.isVisible());
  assert.match(await summary.innerText(),/這不是同步執行清單/);
  assert.equal(await summary.locator("li").count(),4);
  assert.match(await summary.innerText(),/預定上傳 1/);
  assert.match(await summary.innerText(),/保留兩份 1/);
  assert.match(await summary.innerText(),/預定下載 1/);
  console.log("PASS M2 independent note choices, non-executable in-memory review summary");

  await page.getByRole("button",{name:"衝突",exact:true}).click();
  assert.equal(await page.locator(".vault-sync-note").count(),1);
  await page.getByRole("button",{name:"全部",exact:true}).click();
  await page.getByRole("searchbox",{name:"搜尋筆記"}).fill("local-new");
  assert.equal(await page.locator(".vault-sync-note").count(),1);
  await page.getByRole("searchbox",{name:"搜尋筆記"}).fill("");
  await page.getByRole("button",{name:"清除選擇"}).click();
  assert.equal(await page.getByRole("button",{name:"清除選擇"}).isDisabled(),true);
  assert.equal(await page.locator("#vault-sync-review-summary").count(),0);
  console.log("PASS filters, search, reset without sending a request");

  // Real integration seam: a locally selected MSI-style read-only JSON
  // snapshot is parsed inside the browser; no file upload/network transfer.
  const handoff=serializeManualM2Handoff(await makeSyntheticM2Preview());
  await page.locator("#vault-sync-handoff-file").setInputFiles({
    name:"msi-review.json",mimeType:"application/json",buffer:Buffer.from(handoff),
  });
  // File.text() is asynchronous; wait for the committed React state rather
  // than racing the browser's file-input change event.
  await page.getByText("MSI 手動匯入 · 唯讀快照")
    .waitFor({state:"visible",timeout:10_000});
  assert.equal(await page.locator(".vault-sync-note").count(),7);
  await page.locator("#vault-sync-handoff-file").setInputFiles({
    name:"invalid.json",mimeType:"application/json",buffer:Buffer.from('{"format":"bad"}'),
  });
  await page.getByText("匯入失敗：不是完整有效的唯讀差異快照，原畫面未更動。")
    .waitFor({state:"visible",timeout:10_000});
  assert.ok(await page.getByText("MSI 手動匯入 · 唯讀快照").isVisible(),
    "Invalid files must not replace a valid preview");
  await page.getByRole("button",{name:"清除私人快照並回到合成預演"}).click();
  assert.ok(await page.getByText("互動預演 · 合成筆記").isVisible());
  console.log("PASS client-only M2 JSON import, invalid rejection, in-memory clear");

  await mkdir(screenshots,{recursive:true});
  await page.screenshot({path:path.join(screenshots,"m2-desktop.png"),fullPage:true});
  await page.setViewportSize({width:375,height:812});
  await page.screenshot({path:path.join(screenshots,"m2-mobile.png"),fullPage:true});
  await page.goto(origin+"/m2-sync-local-fixture?coverage=partial",{waitUntil:"networkidle"});
  const coverageAlert=page.locator(".vault-sync-coverage[role=\"alert\"]");
  assert.match(await coverageAlert.innerText(),/未支援的 Markdown 檔名：2/);
  assert.match(await coverageAlert.innerText(),/未掃描的資料夾：1/);
  assert.equal(await page.getByRole("group",{name:"差異類型篩選"}).count(),1);
  assert.equal(await page.locator(".vault-sync-note").count(),7,
    "Partial scan must not hide or implicitly delete the reviewed rows");
  console.log("PASS M2 partial local coverage warning and accessible filter grouping");
  assert.deepEqual(jsErrors,[],"M2 unexpected JS errors");
  assert.deepEqual(remoteRequests,[],"M2 preview must remain entirely offline");
  console.log("M2_BROWSER_OFFLINE_SUCCESS no external requests or real sync");
  console.log("Synthetic screenshots: "+screenshots);
  await context.close();
}finally{
  if(browser)await browser.close().catch(()=>{});
  if(server){
    if(server.exitCode===null){
      const stopped=new Promise(resolve=>server.once("exit",resolve));
      server.kill();
      await Promise.race([stopped,delay(2000)]);
    }
  }
  await rm(fixture,{recursive:true,force:true}).catch(()=>{});
  await rm(path.join(root,".next","dev","types"),{recursive:true,force:true}).catch(()=>{});
  await writeFile(nextEnvPath,previousNextEnv,"utf8");
}
