/**
 * P3 actual Next.js + Chrome Knowledge Atlas smoke with synthetic local-only
 * fixture. It never calls Neon/production, never creates a real user or writes
 * any private note. Fixture route is created transiently and deleted in finally.
 */
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright-core";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const fixture=path.join(root,"app","graph-test-local-fixture");
const browsers=[
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath=browsers.find(existsSync);
if(!executablePath)throw Error("Chrome or Edge unavailable on MSI");
if(existsSync(fixture))throw Error("Refusing to overwrite existing graph fixture");
const id=i=>`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`;
const fixturePage=`import "@/app/vault/vault.css";
import VaultKnowledgeGraph from "@/components/vault-knowledge-graph";
import {buildKnowledgeGraph} from "@/lib/knowledge-graph";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false}};
const notes=[
 {id:"${id(1)}",slug:"neon-auth",title:"Neon Auth",category:"Security",tags:["JWT","Authentication"]},
 {id:"${id(2)}",slug:"rls",title:"RLS 資料隔離",category:"Database",tags:["PostgreSQL"]},
 {id:"${id(3)}",slug:"nextjs",title:"Next.js",category:"Frontend",tags:["React"]},
 {id:"${id(4)}",slug:"jwt",title:"JSON Web Token",category:"Security",tags:["JWT"]},
 {id:"${id(5)}",slug:"knowledge",title:"知識管理",category:"Productivity",tags:["PKM"]},
 {id:"${id(6)}",slug:"unlinked",title:"未建立連結",category:"Productivity",tags:[]},
];
const refs=[
 {source_note_id:notes[0].id,target_key:"rls"},
 {source_note_id:notes[0].id,target_key:"jwt"},
 {source_note_id:notes[1].id,target_key:"neon-auth"},
 {source_note_id:notes[2].id,target_key:"neon-auth"},
 {source_note_id:notes[4].id,target_key:"unresolved-future-idea"},
];
export default async function GraphFixture({searchParams}){
 const {focus}=await searchParams;
 return <VaultKnowledgeGraph graph={buildKnowledgeGraph(notes,refs)}
   initialFocusId={typeof focus==="string"?focus:null}
   notesTruncated={false} linksTruncated={false}/>;
}
`;
function freePort(){
 return new Promise((resolve,reject)=>{
  const tcp=createServer();tcp.once("error",reject);
  tcp.listen(0,"127.0.0.1",()=>{const port=tcp.address().port;tcp.close(()=>resolve(port));});
 });
}
let child,browser;
const dir=path.join(os.tmpdir(),"naosledge-private-graph-smoke");
try{
 await mkdir(fixture,{recursive:true});
 await writeFile(path.join(fixture,"page.tsx"),fixturePage,{encoding:"utf8"});
 const port=await freePort(),origin=`http://localhost:${port}`;
 child=spawn(process.execPath,[
  path.join(root,"node_modules","next","dist","bin","next"),
  "dev","--hostname","localhost","--port",String(port),
 ],{
  cwd:root,
  env:{
    ...process.env,NODE_ENV:"development",
    NAOSLEDGE_BACKEND:"neon",NEXT_PUBLIC_NAOSLEDGE_BACKEND:"neon",
    NAOSLEDGE_NEON_BRANCH_ID:"br-quiet-sunset-b4xx4pnx",
    NEON_AUTH_BASE_URL:"https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth",
    NEON_DATA_API_URL:"https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1",
    NEON_AUTH_COOKIE_SECRET:randomBytes(48).toString("base64url"),
    NEXT_PUBLIC_SITE_URL:origin,
  },
  windowsHide:true,stdio:["ignore","pipe","pipe"],
 });
 let output="";
 for(const s of [child.stdout,child.stderr]){
   s.setEncoding("utf8");
   s.on("data",chunk=>{output=(output+chunk).slice(-1400)});
 }
 let ready=false;
 for(let i=0;i<170;i++){
  if(child.exitCode!==null)throw Error("Local Next exited unexpectedly");
  try{
   const response=await fetch(origin+"/graph-test-local-fixture",{signal:AbortSignal.timeout(1400)});
   if(response.ok){ready=true;break}
  }catch{}
  await delay(500);
 }
 if(!ready)throw Error("Local Graph fixture did not become ready; Next may have build errors");
 browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox"]});
 const ctx=await browser.newContext({viewport:{width:375,height:812},deviceScaleFactor:1});
 const page=await ctx.newPage();
 const jsErrors=[],externalRequests=[];
 page.on("pageerror",e=>jsErrors.push(e.message?.slice(0,100)));
 page.on("request",r=>{
   const url=r.url();
   if(!url.startsWith(origin+"/")&&!url.startsWith("data:")&&!url.startsWith("blob:"))
     externalRequests.push("unexpected_external_request");
 });
 for(const width of [375,768,1024,1440]){
   await page.setViewportSize({width,height:width===375?812:880});
   const response=await page.goto(origin+"/graph-test-local-fixture",{waitUntil:"networkidle"});
   assert.equal(response.status(),200);
   await page.getByRole("heading",{name:/知識網絡/}).first().waitFor();
   const metrics=await page.evaluate(()=>({
     doc:document.documentElement.scrollWidth,
     viewport:innerWidth,
     graphScroll:document.querySelector(".vault-graph-scroll")?.scrollWidth,
     graphViewport:document.querySelector(".vault-graph-scroll")?.clientWidth,
     graphLeft:document.querySelector(".vault-graph-scroll")?.scrollLeft,
   }));
   assert.ok(metrics.doc<=metrics.viewport+1,`document overflow at ${width}px: ${JSON.stringify(metrics)}`);
   assert.ok(metrics.graphScroll>=metrics.graphViewport);
   assert.equal(await page.locator(".vault-graph-node").count(),6);
   assert.equal(await page.locator(".vault-graph-directory-item").count(),6);
   if(width===375){
     assert.ok(metrics.graphScroll>metrics.graphViewport,
       "mobile graph should be internally scrollable: "+JSON.stringify(metrics));
     assert.ok(metrics.graphLeft>100,
       "mobile overview should begin centered on constellation: "+JSON.stringify(metrics));
     assert.ok(await page.getByText(/可左右滑動圖譜/).isVisible());
   }
   console.log(`PASS graph responsive ${width}px, accessible directory present, no page overflow`);
 }
 await page.setViewportSize({width:1024,height:850});
 await page.goto(origin+"/graph-test-local-fixture",{waitUntil:"networkidle"});
 await page.locator('.vault-graph-node[aria-label="選取知識筆記：Neon Auth"]').click();
 assert.equal(await page.locator(".vault-graph-inspector h2").innerText(),"Neon Auth");
 assert.ok(await page.getByRole("link",{name:/開啟／編輯原始筆記/}).isVisible());
 assert.equal(await page.getByRole("link",{name:/開啟／編輯原始筆記/}).getAttribute("href"),"/vault/"+id(1));
 assert.ok(await page.getByRole("button",{name:"全覽"}).isVisible());
 assert.equal(await page.getByText("相鄰筆記").count(),1);
 console.log("PASS graph selected node inspector, private note URL and two-hop focus");
 await page.goto(origin+"/graph-test-local-fixture?focus="+id(1),{waitUntil:"networkidle"});
 assert.equal(await page.locator(".vault-graph-inspector h2").innerText(),"Neon Auth");
 assert.ok(await page.locator('.vault-graph-node.selected[aria-label="選取知識筆記：Neon Auth"]').isVisible());
 console.log("PASS direct note-to-graph deep link focuses its owner-visible node");
 await page.getByRole("button",{name:"全覽"}).click();
 assert.equal(await page.locator(".vault-graph-node").count(),6);
 await page.locator("#vault-graph-query").fill("PostgreSQL");
 assert.equal(await page.locator(".vault-graph-directory-item").count(),1);
 assert.equal(await page.locator(".vault-graph-node").count(),1);
 await page.getByRole("button",{name:/清除篩選/}).click();
 await page.locator(".vault-graph-category select").selectOption("Security");
 assert.equal(await page.locator(".vault-graph-directory-item").count(),2);
 await page.locator(".vault-graph-category select").selectOption("");
 await page.getByLabel("只看已連結的筆記").check();
 assert.equal(await page.locator(".vault-graph-directory-item").count(),4);
 console.log("PASS search, category and connected-only filters update real graph");
 await page.getByRole("button",{name:/清除篩選/}).click();
 const focusButton=page.getByRole("button",{name:"聚焦筆記 Neon Auth"});
 await focusButton.focus();
 await page.keyboard.press("Enter");
 assert.ok(await page.getByRole("button",{name:"全覽"}).isVisible());
 const afterKeyFocus=await page.locator('.vault-graph-directory-item button[aria-pressed="true"]').count();
 assert.equal(afterKeyFocus,1);
 console.log("PASS keyboard focus / Enter activates graph, accessible list alternative");
 const svgNode=page.locator('.vault-graph-node[aria-label="選取知識筆記：JSON Web Token"]');
 await svgNode.focus();
 await page.keyboard.press("Enter");
 assert.equal(await page.locator(".vault-graph-inspector h2").innerText(),"JSON Web Token");
 console.log("PASS SVG focus / Enter selects a neuron without a pointer");
 await mkdir(dir,{recursive:true});
 await page.evaluate(()=>{
   if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
   window.scrollTo({top:0,left:0,behavior:"instant"});
 });
 await page.screenshot({path:path.join(dir,"knowledge-atlas-desktop.png"),fullPage:true});
 await page.setViewportSize({width:375,height:812});
 await page.waitForFunction(()=>{
   const container=document.querySelector(".vault-graph-scroll");
   const dot=document.querySelector(".vault-graph-node.selected .vault-graph-dot");
   if(!container||!dot)return false;
   const viewport=container.getBoundingClientRect(),node=dot.getBoundingClientRect();
   return container.scrollLeft>100 &&
     node.left+node.width/2>viewport.left+16 &&
     node.left+node.width/2<viewport.right-16;
 },{timeout:12000});
 console.log("PASS mobile selected neuron automatically centered after viewport change");
 await page.evaluate(()=>{
   if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
   window.scrollTo({top:0,left:0,behavior:"instant"});
 });
 await page.screenshot({path:path.join(dir,"knowledge-atlas-mobile.png"),fullPage:true});
 assert.deepEqual(jsErrors,[],"Unexpected JavaScript errors in Graph");
 assert.deepEqual(externalRequests,[],"Synthetic Graph must never contact outside hosts");
 await ctx.close();
 console.log("KNOWLEDGE_ATLAS_BROWSER_SUCCESS all synthetic, no Neon/production calls");
 console.log("Screenshots on MSI temp only (not committed): "+dir);
}catch(err){
 throw Error("Knowledge Graph Chrome smoke failed: "+String(err.message).slice(0,250));
}finally{
 if(browser)await browser.close().catch(()=>{});
 if(child)child.kill();
 await delay(250);
 await rm(fixture,{recursive:true,force:true});
 // Next.js dev type generation retains removed temporary route names in
 // .next/dev/types/validator.ts. Clear only this regenerable dev cache so
 // subsequent npm run typecheck/build won't inspect deleted test pages.
 await rm(path.join(root,".next","dev","types"),{recursive:true,force:true});
}
