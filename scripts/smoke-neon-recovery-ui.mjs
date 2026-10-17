/**
 * Safe Neon password recovery UI smoke: displays pages on localhost only,
 * NEVER submits an Auth request, NEVER creates an account or sends an email.
 * The public Neon endpoint strings are checked by the app but never called.
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browsers = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = browsers.find(existsSync);
if (!executablePath) throw new Error("Chrome/Edge not found on local MSI");

async function freePort() {
  return new Promise((resolve,reject)=>{
    const s=createTcpServer();
    s.once("error", reject);
    s.listen(0,"127.0.0.1",()=>{const port=s.address().port;s.close(()=>resolve(port));});
  });
}
async function waitForReady(origin,child) {
  for(let i=0;i<150;i++) {
    if(child.exitCode!==null) throw new Error("Next.js local process exited early");
    try {
      if((await fetch(origin+"/about",{signal:AbortSignal.timeout(1000)})).ok) return;
    } catch { /* compiling */ }
    await delay(450);
  }
  throw new Error("Timed out waiting for local Next.js");
}

const port=await freePort();
const origin=`http://localhost:${port}`;
const env={
  ...process.env, NODE_ENV:"development",
  NAOSLEDGE_BACKEND:"neon", NEXT_PUBLIC_NAOSLEDGE_BACKEND:"neon",
  NAOSLEDGE_NEON_BRANCH_ID:"br-quiet-sunset-b4xx4pnx",
  NEON_AUTH_BASE_URL:"https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth",
  NEON_DATA_API_URL:"https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1",
  NEON_AUTH_COOKIE_SECRET:randomBytes(48).toString("base64url"),
  NEXT_PUBLIC_SITE_URL:origin,
};
const child=spawn(process.execPath,[
  path.join(root,"node_modules","next","dist","bin","next"),
  "dev","--hostname","localhost","--port",String(port),
],{cwd:root,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
let browser;
let output="";
for(const stream of [child.stdout,child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data",chunk=>{output=(output+chunk).slice(-1800);});
}
try {
  await waitForReady(origin,child);
  browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox"]});
  const context=await browser.newContext({viewport:{width:375,height:812}});
  const page=await context.newPage();
  const scriptErrors=[];
  page.on("pageerror",error=>scriptErrors.push(error.message));
  const remoteRequests=[];
  page.on("request",req=>{
    const url=req.url();
    if(!url.startsWith(origin+"/")&&!url.startsWith("data:")&&!url.startsWith("blob:")) remoteRequests.push(url);
  });

  let response=await page.goto(origin+"/forgot-password",{waitUntil:"networkidle"});
  assert.equal(response.status(),200);
  assert.ok(await page.getByRole("heading",{name:"找回登入權限。"}).isVisible());
  assert.ok(await page.getByRole("button",{name:/寄送設定連結/}).isVisible());
  console.log("PASS: sandbox forgot-password page renders without contacting Neon");

  response=await page.goto(origin+"/reset-password?token=bad",{waitUntil:"networkidle"});
  assert.equal(response.status(),200);
  assert.ok(await page.getByText(/重設連結無效或已過期/).isVisible());
  assert.equal(await page.locator("#new-password").count(),0);
  assert.equal(new URL(page.url()).search,"");
  console.log("PASS: invalid reset token is rejected without revealing it");

  response=await page.goto(origin+"/reset-password?token=syntheticOnlyResetToken123456789",{waitUntil:"networkidle"});
  assert.equal(response.status(),200);
  assert.match(response.headers()["cache-control"] || "", /no-store/);
  assert.equal(response.headers()["referrer-policy"], "no-referrer");
  await page.waitForFunction(()=>window.location.search==="");
  assert.ok(await page.locator("#new-password").isVisible());
  assert.ok(await page.locator("#confirm-password").isVisible());
  await page.locator("#new-password").fill("local-test-passphrase-123");
  await page.locator("#confirm-password").fill("different-passphrase-456");
  await page.getByRole("button",{name:"設定新密碼"}).click();
  assert.ok(await page.getByText("兩次輸入的密碼不一致。").isVisible());
  assert.deepEqual(scriptErrors,[]);
  assert.deepEqual(remoteRequests,[]);
  console.log("PASS: reset token removed from browser URL and invalid confirmation blocked");
  console.log("NEON_RECOVERY_UI_SUCCESS: no email, database, or Auth network calls");
  await context.close();
} catch(error) {
  // Keep test secrets and callback tokens out of reports.
  throw new Error("Recovery UI smoke failed: "+String(error.message).slice(0,180));
} finally {
  if(browser) await browser.close().catch(()=>{});
  child.kill();
}
