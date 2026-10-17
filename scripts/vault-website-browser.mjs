/**
 * MSI-only Chrome E2E using authenticated SYNTHETIC Neon Sandbox accounts.
 * Called by verify-knowledge-sandbox.mjs only after temporary test grants.
 * Never exposes passwords, tokens, cookies or private text in test logs.
 */
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {spawn} from "node:child_process";
import {createServer as createTcpServer} from "node:net";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {chromium} from "playwright-core";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const EXE=[
 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
 "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
 "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const SANDBOX_AUTH="https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
const SANDBOX_DATA="https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1";
const BRANCH="br-quiet-sunset-b4xx4pnx";
async function freePort(){
 return await new Promise((resolve,reject)=>{
   const server=createTcpServer();
   server.once("error",reject);
   server.listen(0,"127.0.0.1",()=>{
     const port=server.address().port;
     server.close(()=>resolve(port));
   });
 });
}
async function waitReady(origin,child){
 for(let tries=0;tries<160;tries++){
  if(child.exitCode!==null)throw Error("Local Next.js exited unexpectedly");
  try{
   const r=await fetch(origin+"/about",{signal:AbortSignal.timeout(1000)});
   if(r.ok)return;
  }catch{}
  await delay(500);
 }
 throw Error("Local Next.js did not start");
}
const UUID=/^\/vault\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i;
function vaultId(url){
 const path=new URL(url).pathname;
 const id=path.match(UUID)?.[1];
 if(!id)throw Error("Vault save did not redirect to a valid private note id");
 return id;
}
async function assertVaultSave(page){
 try {await page.waitForURL(u=>UUID.test(u.pathname),{timeout:35000});}
 catch {
   const err=await page.locator(".editor-error").allInnerTexts();
   throw Error("Vault save failed: "+err.join("; ").slice(0,130));
 }
}

export async function verifyVaultBrowser({
 owner,bob,reader,authUrl,dataApiUrl,branch,nonce,record,
}) {
 if(authUrl!==SANDBOX_AUTH||dataApiUrl!==SANDBOX_DATA||branch!==BRANCH||
    typeof nonce!=="string"||!/^[a-f0-9]{14}$/.test(nonce)) {
  throw Error("VAULT_BROWSER_SANDBOX_GUARD");
 }
 const executablePath=EXE.find(existsSync);
 if(!executablePath)throw Error("No Chrome/Edge installed on MSI");
 const origin="http://localhost:"+await freePort();
 const env={
  ...process.env,
  NODE_ENV:"development",
  NAOSLEDGE_ALLOW_UNVERIFIED_SYNTHETIC_QA:"1",
  NAOSLEDGE_BACKEND:"neon",NEXT_PUBLIC_NAOSLEDGE_BACKEND:"neon",
  NAOSLEDGE_NEON_BRANCH_ID:BRANCH,
  NEON_AUTH_BASE_URL:SANDBOX_AUTH,
  NEON_DATA_API_URL:SANDBOX_DATA,
  NEON_AUTH_COOKIE_SECRET:randomBytes(48).toString("base64url"),
  NEXT_PUBLIC_SITE_URL:origin,
 };
 const child=spawn(process.execPath,[
  path.join(root,"node_modules","next","dist","bin","next"),
  "dev","--hostname","localhost","--port",new URL(origin).port,
 ],{cwd:root,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
 let serverLogLength=0;
 for(const stream of [child.stdout,child.stderr]){
  stream.on("data",chunk=>{serverLogLength+=chunk.length;});
 }
 let browser,ctx,bobContext,readerContext;
 try{
  await waitReady(origin,child);
  browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox"]});
  ctx=await browser.newContext({viewport:{width:375,height:812}});
  const page=await ctx.newPage();
  const js=[];
  page.on("pageerror",error=>js.push(error.name));

  let res=await page.goto(origin+"/vault",{waitUntil:"networkidle"});
  assert.equal(res.status(),200);
  assert.match(page.url(),/\/login(?:\?|$)/);
  res=await page.goto(origin+"/vault/new",{waitUntil:"networkidle"});
  assert.match(page.url(),/\/login(?:\?|$)/);
  console.log("PASS Chrome anonymous private Vault redirected to login");

  readerContext=await browser.newContext({viewport:{width:375,height:812}});
  const guestPage=await readerContext.newPage();
  await guestPage.goto(origin+"/login",{waitUntil:"networkidle"});
  await guestPage.locator("#email").fill(reader.email);
  await guestPage.locator("#password").fill(reader.password);
  await guestPage.getByRole("button",{name:/進入工作室/}).click();
  await guestPage.getByText(/此帳號沒有站長權限/).waitFor({timeout:25000});
  await guestPage.goto(origin+"/vault",{waitUntil:"networkidle"});
  assert.match(guestPage.url(),/\/login(?:\?|$)/);
  console.log("PASS Chrome signed-in non-admin cannot open Private Vault");

  await page.goto(origin+"/login",{waitUntil:"networkidle"});
  await page.locator("#email").fill(owner.email);
  await page.locator("#password").fill(owner.password);
  await page.getByRole("button",{name:/進入工作室/}).click();
  await page.waitForURL(u=>u.pathname==="/studio",{timeout:30000});
  const goVault=page.getByRole("link",{name:"私人知識庫"});
  assert.ok(await goVault.isVisible());
  await goVault.click();
  await page.waitForURL(u=>u.pathname==="/vault",{timeout:20000});
  assert.ok(await page.getByRole("heading",{name:/我的知識庫/}).isVisible());
  console.log("PASS Chrome signed Neon Auth session opens owner-only Vault");

  const firstSlug="vaultqa-browser-a-"+nonce;
  await page.getByRole("link",{name:/新增私人筆記/}).first().click();
  await page.waitForURL(u=>u.pathname==="/vault/new",{timeout:20000});
  await page.locator("#vault-title").fill("Sandbox Browser Neuron A");
  await page.locator("#vault-slug").fill(firstSlug);
  await page.locator("#vault-summary").fill("私有神經元中文摘要");
  await page.locator("#vault-content").fill("## 實際網站測試\n\nNeon Auth protects my private notes.");
  await page.getByRole("button",{name:/儲存私人筆記/}).click();
  await assertVaultSave(page);
  const id1=vaultId(page.url());
  record("note",owner,id1);
  assert.equal(await page.locator("#vault-title").inputValue(),"Sandbox Browser Neuron A");
  console.log("PASS Chrome Vault Server Action saves first private note");

  const secondSlug="vaultqa-browser-b-"+nonce;
  await page.goto(origin+"/vault/new",{waitUntil:"networkidle"});
  await page.locator("#vault-title").fill("Sandbox Browser Neuron B");
  await page.locator("#vault-slug").fill(secondSlug);
  await page.locator("#vault-summary").fill("私有知識網絡中文測試");
  await page.locator("#vault-content").fill("## Links\n\nSee [["+firstSlug+"|前一個神經元]] and its backlinks.");
  await page.getByRole("button",{name:/儲存私人筆記/}).click();
  await assertVaultSave(page);
  const id2=vaultId(page.url());
  record("note",owner,id2);
  const outgoing=page.locator('.vault-relation[href="/vault/'+id1+'"]');
  assert.ok(await outgoing.isVisible(),"New note should show resolved outgoing wikilink");
  await page.getByRole("button",{name:/預覽關聯/}).click();
  const markupLink=page.locator('.vault-markdown-preview a[href="/vault/'+id1+'"]');
  assert.ok(await markupLink.isVisible(),"Wikilink must render to private URL");
  await page.goto(origin+"/vault/"+id1,{waitUntil:"networkidle"});
  const reverse=page.locator('.vault-relation[href="/vault/'+id2+'"]');
  assert.ok(await reverse.isVisible(),"First note must have backlinks from second");
  console.log("PASS Chrome WikiLinks -> private URL, outgoing links, reverse backlinks");

  await page.goto(origin+"/vault?q="+encodeURIComponent("神經元"),{waitUntil:"networkidle"});
  // The same run also creates API-level fixtures, so the search may return
  // additional synthetic results. Verify the two browser-created notes by ID.
  assert.ok(await page.locator(".vault-list-item").count()>=2);
  assert.equal(await page.locator('.vault-list-item[href="/vault/'+id1+'"]').count(),1);
  assert.equal(await page.locator('.vault-list-item[href="/vault/'+id2+'"]').count(),1);
  console.log("PASS Chrome Chinese search returns both expected private notes");

  bobContext=await browser.newContext({viewport:{width:375,height:812}});
  const bobPage=await bobContext.newPage();
  await bobPage.goto(origin+"/login",{waitUntil:"networkidle"});
  await bobPage.locator("#email").fill(bob.email);
  await bobPage.locator("#password").fill(bob.password);
  await bobPage.getByRole("button",{name:/進入工作室/}).click();
  await bobPage.waitForURL(u=>u.pathname==="/studio",{timeout:30000});
  await bobPage.goto(origin+"/vault",{waitUntil:"networkidle"});
  // Bob already has one API-level fixture from this same test run. The
  // invariant is that he cannot see or search the other owner's notes.
  assert.equal(await bobPage.locator('.vault-list-item[href="/vault/'+id1+'"]').count(),0);
  assert.equal(await bobPage.locator('.vault-list-item[href="/vault/'+id2+'"]').count(),0);
  assert.equal(await bobPage.locator(".vault-list-item").count(),1);
  res=await bobPage.goto(origin+"/vault/"+id1,{waitUntil:"networkidle"});
  assert.equal(res.status(),404);
  console.log("PASS Chrome another admin cannot see other owner's Vault notes");

  await page.goto(origin+"/vault/"+id1,{waitUntil:"networkidle"});
  const postSlug="vaultqa-browser-public-"+nonce;
  page.on("dialog",async dlg=>{
    if(dlg.type()==="prompt")await dlg.accept(postSlug);
    else await dlg.accept();
  });
  await page.getByRole("button",{name:/建立獨立公開草稿/}).click();
  try{
    await page.waitForURL(u=>/^\/studio\/[0-9a-f-]{36}$/i.test(u.pathname),{timeout:35000});
  }catch{
    const err=await page.locator(".editor-error").allInnerTexts();
    throw Error("Browser did not create private-to-public draft: "+err.join("; ").slice(0,130));
  }
  const pubId=page.url().split("/").at(-1);
  record("post",owner,pubId);
  assert.ok(await page.getByRole("button",{name:/發布文章/}).isVisible());
  res=await guestPage.goto(origin+"/notes/"+postSlug,{waitUntil:"networkidle"});
  assert.equal(res.status(),404);
  console.log("PASS Chrome selective publish creates DRAFT only; anonymous still 404");

  assert.deepEqual(js,[],"No browser JS exceptions");
  console.log("NEON_VAULT_BROWSER_SUCCESS actual Next.js Chrome, Neon Auth/JWT/Data API private CRUD/backlinks/preview/draft");
 } catch(e) {
  console.error("NEON_VAULT_BROWSER_FAILURE "+String(e?.message||"unknown").slice(0,240));
  // Deliberately never dump Next.js logs, which can contain session metadata.
  throw e;
 } finally{
  if(bobContext)await bobContext.close().catch(()=>{});
  if(readerContext)await readerContext.close().catch(()=>{});
  if(ctx)await ctx.close().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  child.kill();
 }
}
