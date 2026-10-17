/**
 * A real Next.js + Chrome smoke against the previously approved Neon SANDBOX.
 * Called only from verify-neon-sandbox.mjs with synthetic credentials in RAM.
 * Never invoked from CI or a production deployment.
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

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserPaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function unusedPort() {
  return new Promise((resolve,reject)=>{
    const sock = createTcpServer();
    sock.once("error",reject);
    sock.listen(0,"127.0.0.1",()=>{
      const port=sock.address().port;
      sock.close(()=>resolve(port));
    });
  });
}
async function ready(origin,child) {
  for(let tries=0;tries<160;tries++){
    if(child.exitCode!==null) throw new Error("Next.js exit="+child.exitCode);
    try {
      const res=await fetch(origin+"/about",{signal:AbortSignal.timeout(1100)});
      if(res.ok) return;
    } catch{}
    await delay(500);
  }
  throw new Error("Next.js local sandbox timed out");
}
export async function verifyNeonBrowser({owner,guest,authUrl,dataApiUrl,branch}) {
  if (branch!=="br-quiet-sunset-b4xx4pnx" ||
      !authUrl.startsWith("https://ep-square-cloud-b45d18zl.neonauth.") ||
      !dataApiUrl.startsWith("https://ep-square-cloud-b45d18zl.apirest.")) {
    throw new Error("SANDBOX_BROWSER_GUARD refused unsupported branch");
  }
  const executablePath=browserPaths.find(existsSync);
  if(!executablePath) throw new Error("No installed Chrome or Edge for isolated browser test.");
  const port=await unusedPort();
  const origin=`http://localhost:${port}`;
  const env={
    ...process.env,
    NODE_ENV:"development",
    NAOSLEDGE_ALLOW_UNVERIFIED_SYNTHETIC_QA:"1",
    NAOSLEDGE_BACKEND:"neon",
    NEXT_PUBLIC_NAOSLEDGE_BACKEND:"neon",
    NAOSLEDGE_NEON_BRANCH_ID:branch,
    NEON_AUTH_BASE_URL:authUrl,
    NEON_DATA_API_URL:dataApiUrl,
    NEON_AUTH_COOKIE_SECRET:randomBytes(48).toString("base64url"),
    NEXT_PUBLIC_SITE_URL:origin,
  };
  const child=spawn(process.execPath,[
    path.join(repo,"node_modules","next","dist","bin","next"),
    "dev","--hostname","localhost","--port",String(port),
  ],{cwd:repo,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let output="";
  for(const stream of [child.stdout,child.stderr]){
    stream.setEncoding("utf8");
    stream.on("data",chunk=>{output=(output+chunk).slice(-4500)});
  }
  let browser,context;
  const slug="neon-website-"+randomBytes(6).toString("hex");
  try {
    await ready(origin,child);
    browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox"]});
    context=await browser.newContext({viewport:{width:375,height:812}});
    const page=await context.newPage();
    const jsErrors=[];
    page.on("pageerror",error=>jsErrors.push(error.message));

    let res=await page.goto(origin+"/",{waitUntil:"networkidle"});
    assert.equal(res.status(),200);
    assert.equal(await page.locator(".index-row").count(),0);
    res=await page.goto(origin+"/studio",{waitUntil:"networkidle"});
    assert.equal(res.status(),200);
    assert.match(page.url(),/\/login(?:\?|$)/);
    console.log("PASS actual Next.js Neon website public homepage and anonymous Studio redirect");

    // A real signed-in non-admin must not gain Studio access.
    await page.locator("#email").fill(guest.email);
    await page.locator("#password").fill(guest.password);
    await page.getByRole("button",{name:/進入工作室/}).click();
    await page.getByText(/此帳號沒有站長權限/).waitFor({timeout:25000});
    await page.goto(origin+"/studio",{waitUntil:"networkidle"});
    assert.match(page.url(),/\/login(?:\?|$)/);
    console.log("PASS actual Next.js Neon non-admin rejected and signed out");

    await page.locator("#email").fill(owner.email);
    await page.locator("#password").fill(owner.password);
    await page.getByRole("button",{name:/進入工作室/}).click();
    try {
      await page.waitForURL(url=>url.pathname==="/studio",{timeout:28000});
    } catch(e) {
      const safeError=await page.locator(".form-error").allInnerTexts();
      throw new Error("Admin browser login blocked: "+safeError.join("; ").slice(0,200));
    }
    assert.ok(await page.getByRole("link",{name:/新增筆記/}).isVisible());
    console.log("PASS actual Next.js HTTP-only Neon Auth session and admin Studio access");

    await page.goto(origin+"/studio/new",{waitUntil:"networkidle"});
    await page.locator("#post-title").fill("Neon 隔離網站整合驗證");
    await page.locator("#post-slug").fill(slug);
    await page.locator("#post-content").fill("## 隔離測試\n\n這是一篇僅用於 Naosledge 的合成 Markdown 草稿。");
    await page.getByRole("button",{name:"儲存草稿"}).click();
    try {
      await page.waitForURL(url=>url.pathname==="/studio",{timeout:24000});
    } catch {
      const err=await page.locator(".editor-error").allInnerTexts();
      throw new Error("Studio draft save failed: "+err.join("; ").slice(0,180));
    }
    console.log("PASS actual Next.js Server Action creates sandbox draft");

    const guestContext=await browser.newContext({viewport:{width:375,height:812}});
    const guestPage=await guestContext.newPage();
    res=await guestPage.goto(origin+"/notes/"+slug,{waitUntil:"networkidle"});
    assert.equal(res.status(),404,"Draft must return 404 to anonymous visitor");
    await guestPage.goto(origin+"/",{waitUntil:"networkidle"});
    assert.equal(await guestPage.getByText("Neon 隔離網站整合驗證").count(),0);
    console.log("PASS actual Next.js anonymous page cannot see sandbox draft");

    const editLink=page.locator(".studio-list-main a").filter({hasText:"Neon 隔離網站整合驗證"});
    assert.equal(await editLink.count(),1);
    await editLink.click();
    await page.getByRole("button",{name:"發布文章"}).click();
    try {
      await page.waitForURL(url=>url.pathname==="/studio",{timeout:24000});
    } catch {
      const err=await page.locator(".editor-error").allInnerTexts();
      throw new Error("Studio publish failed: "+err.join("; ").slice(0,180));
    }
    res=await guestPage.goto(origin+"/notes/"+slug,{waitUntil:"networkidle"});
    assert.equal(res.status(),200,"Published article must be readable anonymously");
    assert.match(await guestPage.locator("h1").innerText(),/Neon 隔離網站整合驗證/);
    console.log("PASS actual Next.js publish -> anonymous 200");

    await editLink.click();
    await page.locator("#post-title").fill("Neon 隔離文章編輯完成");
    await page.getByRole("button",{name:"更新公開文章"}).click();
    await page.waitForURL(url=>url.pathname==="/studio",{timeout:24000});
    res=await guestPage.goto(origin+"/notes/"+slug,{waitUntil:"networkidle"});
    assert.equal(res.status(),200);
    assert.match(await guestPage.locator("h1").innerText(),/文章編輯完成/);
    console.log("PASS actual Next.js editing published article");

    const editedLink=page.locator(".studio-list-main a").filter({hasText:"Neon 隔離文章編輯完成"});
    await editedLink.click();
    page.once("dialog",dialog=>dialog.accept());
    await page.getByRole("button",{name:"永久刪除文章"}).click();
    await page.waitForURL(url=>url.pathname==="/studio",{timeout:24000});
    res=await guestPage.goto(origin+"/notes/"+slug,{waitUntil:"networkidle"});
    assert.equal(res.status(),404);
    console.log("PASS actual Next.js authorized delete -> anonymous 404");

    await page.getByRole("button",{name:/登出/}).click();
    await page.waitForURL(url=>url.pathname==="/",{timeout:25000});
    await page.goto(origin+"/studio",{waitUntil:"networkidle"});
    assert.match(page.url(),/\/login(?:\?|$)/);
    assert.deepEqual(jsErrors,[]);
    console.log("PASS actual Next.js logout and no browser JavaScript errors");
    await guestContext.close();
    console.log("NEON_WEBSITE_BROWSER_SUCCESS");
  } catch(e) {
    console.error("NEON_WEBSITE_BROWSER_FAILURE "+String(e?.message||"unknown").slice(0,240));
    console.error("NEON_SANDBOX_POSSIBLE_POST_SLUG "+slug);
    // Server logs are not printed: they may include session/cookie metadata.
    throw e;
  } finally {
    if(context) await context.close().catch(()=>{});
    if(browser) await browser.close().catch(()=>{});
    child.kill();
  }
}
