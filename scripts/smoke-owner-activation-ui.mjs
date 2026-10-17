/**
 * Browser-only preview identity simulator. No Neon request, no email, no JWT.
 * Vercel system metadata is simulated on localhost for UI validation only.
 * NEVER use these placeholders in the actual Vercel project settings.
 */
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {setTimeout as wait} from "node:timers/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {chromium} from "playwright-core";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const browsers=[
 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
 "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
 "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath=browsers.find(existsSync);
if(!executablePath)throw Error("Chrome/Edge missing");
async function port(){
 return await new Promise((resolve,reject)=>{
  const s=createServer();
  s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const num=s.address().port;s.close(()=>resolve(num));});
 });
}
const num=await port();
const localhost=`http://localhost:${num}`;
const host="naosledge-git-feat-owner-activation-20261017-naos-tsais-projects.vercel.app";
const env={
 ...process.env,
 NODE_ENV:"development",
 VERCEL:"1",VERCEL_ENV:"preview",
 VERCEL_PROJECT_ID:"prj_JEXZkiab0njUM7VWFhDO0NhL0GtH",
 VERCEL_GIT_COMMIT_REF:"feat/owner-activation-20261017",
 VERCEL_BRANCH_URL:host,
 NAOSLEDGE_OWNER_ACTIVATION_ENABLED:"1",
 NAOSLEDGE_OWNER_ACTIVATION_ORIGIN:"https://"+host,
 NAOSLEDGE_OWNER_ACTIVATION_AUTH_URL:
  "https://ep-purple-recipe-b43kznn2.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth",
 NAOSLEDGE_OWNER_ACTIVATION_EMAIL:"synthetic-test-only@example.com",
 NAOSLEDGE_OWNER_ACTIVATION_COOKIE_SECRET:randomBytes(48).toString("base64url"),
 NAOSLEDGE_BACKEND:"supabase",
 NEXT_PUBLIC_NAOSLEDGE_BACKEND:"supabase",
};
const child=spawn(process.execPath,[
 path.join(root,"node_modules","next","dist","bin","next"),
 "dev","--hostname","localhost","--port",String(num),
],{cwd:root,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
for(const s of [child.stdout,child.stderr])s.on("data",()=>{});
let browser;
try{
 let ready=false;
 for(let i=0;i<160;i++){
  if(child.exitCode!==null)throw Error("Next exited before ready");
  try{if((await fetch(localhost+"/owner-activation",{signal:AbortSignal.timeout(850)})).ok){ready=true;break}}catch{}
  await wait(450);
 }
 if(!ready)throw Error("Next UI smoke startup timed out");
 browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox"]});
 const ctx=await browser.newContext({viewport:{width:375,height:812}});
 const page=await ctx.newPage();
 const errors=[],remote=[];
 page.on("pageerror",e=>errors.push(e.name));
 page.on("request",r=>{
  if(!r.url().startsWith(localhost+"/")&&!r.url().startsWith("data:")&&!r.url().startsWith("blob:"))
   remote.push("external-request-blocked");
 });
 let res=await page.goto(localhost+"/owner-activation",{waitUntil:"networkidle"});
 assert.equal(res.status(),200);
 assert.ok(await page.getByRole("heading",{name:"啟用站長帳號。"}).isVisible());
 assert.ok(await page.getByRole("button",{name:/寄送 Email 驗證通知/}).isVisible());
 assert.ok(await page.getByRole("button",{name:/申請首次設定密碼連結/}).isVisible());
 assert.ok(await page.locator("#owner-verification-otp").isVisible());
 console.log("PASS: owner activation form renders without sending an email");
 for(const otherRoute of ["/","/about","/studio","/vault","/forgot-password","/robots.txt"]) {
   // Node fetch can inspect an intentionally bodyless HTTP 404 without
   // Chromium treating navigation to the empty error response as a failure.
   const blocked=await fetch(localhost+otherRoute,{redirect:"manual"});
   assert.equal(blocked.status,404,"Standalone owner Preview must block "+otherRoute);
   assert.match(blocked.headers.get("cache-control")||"",/no-store/);
   assert.match(blocked.headers.get("x-robots-tag")||"",/noindex/);
 }
 console.log("PASS: owner-only Preview refuses blog, Studio, Vault, recovery and robots routes");
 res=await page.goto(localhost+"/owner-activation/reset?token=short",{waitUntil:"networkidle"});
 assert.equal(res.status(),200);
 assert.match(res.headers()["cache-control"]||"",/no-store/);
 assert.equal(res.headers()["referrer-policy"],"no-referrer");
 await page.waitForFunction(()=>window.location.search==="");
 assert.ok(await page.getByText(/連結無效或已過期/).isVisible());
 assert.equal(await page.locator("#owner-new-password").count(),0);
 console.log("PASS: invalid Owner token rejected and scrubbed from browser URL");
 res=await page.goto(localhost+"/owner-activation/reset?token=syntheticOwnerResetToken1234567890",{waitUntil:"networkidle"});
 assert.equal(res.status(),200);
 await page.waitForFunction(()=>window.location.search==="");
 await page.locator("#owner-new-password").waitFor({state:"visible",timeout:12000});
 await page.locator("#owner-new-password").fill("synthetic-password-only-1234");
 await page.locator("#owner-confirm-password").fill("different-synthetic-5678");
 await page.getByRole("button",{name:/設定新密碼/}).click();
 assert.ok(await page.getByText(/兩次輸入的密碼不一致/).isVisible());
 console.log("PASS: Owner token never server-rendered; mismatch blocked before Auth request");
 res=await page.goto(localhost+"/owner-activation/verified",{waitUntil:"networkidle"});
 assert.equal(res.status(),200);
 assert.ok(await page.getByText(/不代表 Email 已通過確認/).isVisible());
 assert.equal(errors.length,0);
 assert.equal(remote.length,0);
 console.log("OWNER_ACTIVATION_BROWSER_UI_SUCCESS no Auth or data API network calls");
 await ctx.close();
}catch(e){
 throw Error("Owner activation local-only UI smoke failed: "+String(e.message).slice(0,175));
}finally{
 if(browser)await browser.close().catch(()=>{});
 child.kill();
}
