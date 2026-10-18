/**
 * Synthetic local-only Obsidian Markdown UI acceptance.
 * Transient fixture page is removed after testing; no Neon token, login,
 * Production DB write, real Obsidian Vault or external AI service involved.
 */
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir,writeFile,rm,readFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {chromium} from "playwright-core";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const fixture=path.join(root,"app","obsidian-local-fixture");
const nextEnvPath=path.join(root,"next-env.d.ts");
const initialNextEnv=await readFile(nextEnvPath,"utf8");
if(existsSync(fixture))throw Error("Refusing to overwrite existing fixture");
const browsers=[
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath=browsers.find(existsSync);
if(!executablePath)throw Error("Chrome/Edge not found");

const pageSource=`import "@/app/vault/vault.css";
import VaultEditor from "@/components/vault-editor";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false}};
const initial={
  id:"00000000-0000-4000-8000-000000000001",
  owner_id:"synthetic-offline-owner",
  slug:"obsidian-note",
  title:"原始筆記",
  summary:"原始摘要",
  content_md:"# 原始筆記\\n\\n[[knowledge|我的知識連結]]",
  category:"原始分類",
  tags:["Original"],
  learned_on:"2026-10-18",
  created_at:"2026-10-18T00:00:00Z",
  updated_at:"2026-10-18T00:00:00Z",
};
export default function ObsidianLocalFixture(){
  return <VaultEditor initial={initial} targets={[]} wikiTargets={{}}
    relations={{outgoing:[],backlinks:[],unresolved:[]}} allowPublication={false}/>;
}
`;
async function freePort(){
  return await new Promise((resolve,reject)=>{
    const s=createServer();
    s.once("error",reject);
    s.listen(0,"127.0.0.1",()=>{
      const address=s.address();s.close(()=>resolve(address.port));
    });
  });
}
let child,browser;
try{
  await mkdir(fixture,{recursive:true});
  await writeFile(path.join(fixture,"page.tsx"),pageSource,{encoding:"utf8"});
  const port=await freePort(),origin=`http://localhost:${port}`;
  child=spawn(process.execPath,[
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
  for(let i=0;i<130;i++){
    if(child.exitCode!==null)throw Error("Next exited before test");
    try {
      const r=await fetch(origin+"/obsidian-local-fixture",{signal:AbortSignal.timeout(1200)});
      if(r.ok){ready=true;break}
    }catch{}
    await delay(500);
  }
  if(!ready)throw Error("Local Obsidian UI fixture startup timed out");
  browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox"]});
  const context=await browser.newContext({
    viewport:{width:375,height:812},acceptDownloads:true,
  });
  const page=await context.newPage();
  const errors=[],remote=[];
  page.on("pageerror",e=>errors.push(e.message?.slice(0,140)));
  page.on("request",r=>{
    if(!r.url().startsWith(origin+"/")&&!r.url().startsWith("blob:")&&
       !r.url().startsWith("data:"))remote.push("unexpected-external-request");
  });
  page.on("dialog",dialog=>dialog.accept());
  const res=await page.goto(origin+"/obsidian-local-fixture",{waitUntil:"networkidle"});
  assert.equal(res.status(),200);
  const btn=page.getByRole("button",{name:"Obsidian .md"});
  assert.ok(await btn.isVisible());
  console.log("PASS: Obsidian export button visible at iPhone-sized viewport");

  const downloadPromise=page.waitForEvent("download");
  await btn.click();
  const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),"obsidian-note.md");
  const fileContents=await readFile(await download.path(),"utf8");
  assert.match(fileContents,/^---\ntitle: "原始筆記"/);
  assert.match(fileContents,/aliases: \["原始筆記"\]/);
  assert.match(fileContents,/\[\[knowledge\|我的知識連結\]\]/);
  assert.doesNotMatch(fileContents,/synthetic-offline-owner|session_token/);
  console.log("PASS: browser downloads an Obsidian-compatible private Markdown note");

  const incoming=[
    "---","title: \"來自 Obsidian 的筆記\"","tags:",
    "  - Knowledge","  - \"中文\"","category: 整理","date: 2026-10-17",
    "---","","# 導入正文","保留 [[wiki-target]]",
  ].join("\n");
  await page.locator('input[type="file"]').setInputFiles({
    name:"Obsidian Imported.md",mimeType:"text/markdown",
    buffer:Buffer.from(incoming,"utf8"),
  });
  await page.getByRole("status").filter({hasText:"Obsidian"}).waitFor();
  assert.equal(await page.locator("#vault-title").inputValue(),"來自 Obsidian 的筆記");
  assert.equal(await page.locator("#vault-category").inputValue(),"整理");
  assert.equal(await page.locator("#vault-tags").inputValue(),"Knowledge, 中文");
  assert.equal(await page.locator("#vault-date").inputValue(),"2026-10-17");
  assert.match(await page.locator("#vault-content").inputValue(),/\[\[wiki-target\]\]/);
  console.log("PASS: imported Obsidian YAML restores metadata and Wikilinks without saving");

  const unknown=[
    "---","title: Unknown YAML","aliases: [\"Must survive\"]",
    "---","","# Raw Markdown and YAML",
  ].join("\n");
  await page.locator('input[type="file"]').setInputFiles({
    name:"custom.md",mimeType:"text/markdown",
    buffer:Buffer.from(unknown,"utf8"),
  });
  await page.waitForFunction(()=>document.querySelector("#vault-content")?.value
    .includes('aliases: ["Must survive"]'));
  assert.match(await page.locator("#vault-content").inputValue(),/aliases: \["Must survive"\]/);
  console.log("PASS: unknown Obsidian fields are not silently dropped");
  assert.equal(remote.length,0);
  assert.equal(errors.length,0,"JS errors: "+errors.join("; "));
  console.log("OBSIDIAN_MARKDOWN_BROWSER_SUCCESS no external network or cloud writes");
  await context.close();
}catch(e){
  throw Error("Obsidian local-only Chrome smoke failed: "+String(e?.message||e).slice(0,240));
}finally{
  if(browser)await browser.close().catch(()=>{});
  if(child){
    if(child.exitCode===null){
      const stopped=new Promise(resolve=>child.once("exit",resolve));
      child.kill();
      await Promise.race([stopped,delay(2000)]);
    }
  }
  await rm(fixture,{recursive:true,force:true}).catch(()=>{});
  // Next dev emits route-specific TS validators that outlive a temporary test
  // page. Clear ONLY generated types containing this specific fixture.
  const devTypes=path.join(root,".next","dev","types");
  try {
    const validator=await readFile(path.join(devTypes,"validator.ts"),"utf8");
    if(validator.includes("obsidian-local-fixture/page.js")){
      await rm(devTypes,{recursive:true,force:true});
    }
  }catch{/* generated caches may already have been cleared */}
  // Next dev may rewrite tracked route typings; keep the checkout unchanged.
  await writeFile(nextEnvPath,initialNextEnv,"utf8");
}
