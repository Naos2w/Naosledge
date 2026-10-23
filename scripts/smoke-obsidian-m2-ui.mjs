/**
 * Real MSI Chrome UI rehearsal for the actual M2 component.
 * Transient local fixture only; no real login, Vault access, Neon network,
 * persistent approvals, uploads or production deployment.
 */
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import os from "node:os";
import {chromium} from "playwright-core";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
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
export default async function M2LocalFixture(){
  return <VaultManualSyncReview preview={await makeSyntheticM2Preview()}/>;
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
    path.join(root,"node_modules","next","dist","bin","next"),
    "dev","--hostname","localhost","--port",String(port),
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
  await page.getByRole("searchbox",{name:"搜尋範例筆記"}).fill("local-new");
  assert.equal(await page.locator(".vault-sync-note").count(),1);
  await page.getByRole("searchbox",{name:"搜尋範例筆記"}).fill("");
  await page.getByRole("button",{name:"清除選擇"}).click();
  assert.equal(await page.getByRole("button",{name:"清除選擇"}).isDisabled(),true);
  assert.equal(await page.locator("#vault-sync-review-summary").count(),0);
  console.log("PASS filters, search, reset without sending a request");

  await mkdir(screenshots,{recursive:true});
  await page.screenshot({path:path.join(screenshots,"m2-desktop.png"),fullPage:true});
  await page.setViewportSize({width:375,height:812});
  await page.screenshot({path:path.join(screenshots,"m2-mobile.png"),fullPage:true});
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
