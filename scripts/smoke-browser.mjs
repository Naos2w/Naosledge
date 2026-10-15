/**
 * Offline smoke test against the actual Next.js app using a loopback fake
 * Supabase endpoint and locally installed Chromium. No real database, login,
 * production endpoint, Vercel account or credentials are used.
 *
 * Run on MSI: npm run test:browser:local
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error("No local Chrome/Edge executable found. Browser smoke is optional.");
const logDir = mkdtempSync(path.join(tmpdir(), "naosledge-browser-"));
const posts = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    author_id: "00000000-0000-4000-8000-000000000000",
    slug: "git-rebase-notes",
    title: "Git Rebase 的學習筆記",
    excerpt: "整理 Git Rebase 工作流程。",
    content_md: "# 今日摘要\n\nRebase 會重新安排 commit 歷史。\n\n## 延伸閱讀\n\n[關於這裡](/about) · [MDN](https://developer.mozilla.org/)\n\n## 圖片與說明\n\n![架構流程示意圖](https://images.example.invalid/learning-diagram.svg \"測試流程圖說明\")\n\n![不安全的圖片連結](http://insecure.example.invalid/track.png)\n\n| 項目 | 說明 |\n| --- | --- |\n| 超長內容 | abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789 |",
    tags: ["Git", "開發"], category: "技術", status: "published",
    learned_on: "2026-10-15", published_at: "2026-10-15T00:00:00Z",
    created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    author_id: "00000000-0000-4000-8000-000000000000",
    slug: "liquid-glass",
    title: "Liquid Glass 設計整理",
    excerpt: "毛玻璃材質與閱讀對比。",
    content_md: "## 今天學到的事\n\n保留正文可讀性。",
    tags: ["設計"], category: "UI/UX", status: "published",
    learned_on: "2026-10-14", published_at: "2026-10-14T00:00:00Z",
    created_at: "2026-10-14T00:00:00Z", updated_at: "2026-10-14T00:00:00Z",
  },
];
// Give the article genuine scroll depth and a repeated heading for TOC coverage.
posts[0].content_md += "\n\n```ts\nconst answer = 42;\n```\n\n## 延伸閱讀\n\n" +
  Array.from({length: 32}, (_, i) => `第 ${i + 1} 段：${"將重要的理解記錄下來，並在未來重新整理。".repeat(5)}`).join("\n\n");

// Synthetic identity and signed token exist only inside this test process.
const mockUser = {
  id: posts[0].author_id, aud: "authenticated", role: "authenticated",
  email: "offline-studio@example.invalid", email_confirmed_at: "2026-10-15T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {}, created_at: "2026-10-15T00:00:00Z",
  updated_at: "2026-10-15T00:00:00Z",
};
const encoded = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const mockClaims = encoded({ alg: "HS256", typ: "JWT" }) + "." + encoded({
  sub: mockUser.id, aud: "authenticated", role: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
});
const mockToken = mockClaims + "." +
  createHmac("sha256", "naosledge-synthetic-local-key").update(mockClaims).digest("base64url");

async function freePort() {
  return new Promise((resolve, reject) => {
    const socket = createTcpServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

async function startMockSupabase() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": req.headers["access-control-request-headers"] || "apikey,authorization,content-type,x-client-info",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    };
    function reply(status, payload) {
      res.writeHead(status, headers);
      res.end(JSON.stringify(payload));
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    const signedIn = req.headers.authorization === `Bearer ${mockToken}`;
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      reply(200, {
        access_token: mockToken, token_type: "bearer",
        refresh_token: "synthetic-refresh-only", expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: mockUser,
      });
      return;
    }
    if (url.pathname === "/auth/v1/user") {
      reply(signedIn ? 200 : 401, signedIn ? mockUser : { message: "invalid session" });
      return;
    }
    if (url.pathname === "/auth/v1/.well-known/jwks.json") {
      reply(200, { keys: [] });
      return;
    }
    if (url.pathname === "/rest/v1/blog_admins") {
      const matchingUser = url.searchParams.get("user_id")?.replace(/^eq\./, "");
      const found = signedIn && (!matchingUser || matchingUser === mockUser.id)
        ? [{ user_id: mockUser.id }] : [];
      reply(200, String(req.headers.accept || "").includes("vnd.pgrst.object") ? found[0] || null : found);
      return;
    }
    if (url.pathname === "/rest/v1/posts") {
      // Minimal in-memory PostgREST adapter, only for this loopback smoke run.
      if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
        if (!signedIn) return reply(403, {code: "42501", message: "anon write denied"});
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        if (req.method === "DELETE") {
          const index = posts.findIndex((post) => post.id === id);
          if (index !== -1) posts.splice(index, 1);
          return reply(200, {});
        }
        let raw = "";
        for await (const chunk of req) raw += chunk.toString("utf8");
        const payload = JSON.parse(raw);
        if (req.method === "POST") {
          const now = new Date().toISOString();
          const record = {
            ...payload, id: randomUUID(), author_id: mockUser.id,
            created_at: now, updated_at: now,
          };
          posts.unshift(record);
          return reply(201, {id: record.id});
        }
        const target = posts.find((post) => post.id === id);
        if (!target) return reply(404, {code: "PGRST116", message: "not found"});
        Object.assign(target, payload, { updated_at: new Date().toISOString() });
        return reply(200, {id: target.id});
      }
      const slug = url.searchParams.get("slug")?.replace(/^eq\./, "");
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      const status = url.searchParams.get("status")?.replace(/^eq\./, "");
      const found = posts.filter((post) =>
        (signedIn || post.status === "published") &&
        (!slug || post.slug === slug) &&
        (!id || post.id === id) &&
        (!status || post.status === status)
      );
      const single = String(req.headers.accept || "").includes("vnd.pgrst.object");
      reply(200, single ? (found[0] || null) : found);
      return;
    }
    reply(404, { error: "offline fixture only" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function waitForServer(address, child) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next process exited: ${child.exitCode}`);
    try {
      const res = await fetch(address + "/about", { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* Next may still be compiling. */ }
    await delay(550);
  }
  throw new Error("Timed out waiting for local Next.js process");
}

const mock = await startMockSupabase();
const mockPort = mock.address().port;
const sitePort = await freePort();
const origin = `http://127.0.0.1:${sitePort}`;
const child = spawn(process.execPath, [
  path.join(root, "node_modules", "next", "dist", "bin", "next"),
  "dev", "--hostname", "127.0.0.1", "--port", String(sitePort),
], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env, NODE_ENV: "development",
    NEXT_PUBLIC_SITE_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_synthetic_smoke_only",
  },
});
let nextOutput = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => { nextOutput = (nextOutput + chunk).slice(-2500); });
}
let browser;
try {
  await waitForServer(origin, child);
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {origin});
  // Images are fulfilled entirely in-memory; never contact example.invalid hosts.
  let blockedRemoteRequests = 0;
  let syntheticImageRequests = 0;
  await context.route("https://images.example.invalid/**", (route) => {
    syntheticImageRequests++;
    return route.fulfill({
      status: 200, contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="405"><rect width="720" height="405" fill="#a2b4c5"/></svg>',
    });
  });
  await context.route("http://insecure.example.invalid/**", (route) => {
    blockedRemoteRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
    const response = await page.goto(origin + "/", { waitUntil: "networkidle" });
    assert.equal(response.status(), 200, `Home must work at width ${width}`);
    assert.match(await page.locator("h1").innerText(), /學到的/);
    assert.equal(await page.locator(".index-row").count(), 2, "Two published synthetic fixtures");
    const dims = await page.evaluate(() => ({
      width: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth,
      headerWidth: Math.ceil(document.querySelector(".site-header").getBoundingClientRect().width),
      theme: document.documentElement.dataset.theme,
    }));
    assert.ok(dims.html <= dims.width && dims.body <= dims.width,
      `Horizontal overflow on ${width}px viewport: ${JSON.stringify(dims)}`);
    assert.equal(dims.theme, "dark");
    assert.ok(dims.headerWidth <= width, "Header should fit mobile viewport");
    console.log(`PASS: homepage renders with no overflow at ${width}px`);
    if (width === 1440 || width === 375) {
      await page.screenshot({ path: path.join(logDir, `homepage-${width}.png`), fullPage: true });
    }
  }

  // A local-only website must not advertise localhost as a canonical domain.
  const robotsResponse = await fetch(origin + "/robots.txt");
  assert.equal(robotsResponse.status, 200);
  assert.match(await robotsResponse.text(), /Disallow:\s*\//i);
  const sitemapResponse = await fetch(origin + "/sitemap.xml");
  assert.equal(sitemapResponse.status, 200);
  const sitemapXml = await sitemapResponse.text();
  assert.doesNotMatch(sitemapXml, /localhost|127\.0\.0\.1|git-rebase-notes/i);
  assert.equal(await page.locator('link[rel="canonical"]').count(), 0);
  assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /noindex/i);
  assert.equal(await page.locator(".heatmap-grid [role='listitem']").count(), 35);
  assert.ok((await page.locator(".heatmap-grid [role='listitem']").first().getAttribute("aria-label"))?.includes("篇公開筆記"));
  console.log("PASS: local SEO does not advertise test URLs; 35 learning days are screen-reader labelled");

  await page.goto(origin + "/?q=Rebase&q=unrelated", { waitUntil: "networkidle" });
  assert.equal(await page.locator(".index-row").count(), 1);
  console.log("PASS: repeated query parameters are handled");
  assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /noindex/i);

  await page.goto(origin + "/?tag=%E8%A8%AD%E8%A8%88", { waitUntil: "networkidle" });
  assert.equal(await page.locator(".index-row").count(), 1);
  console.log("PASS: article tag filtering");

  await page.goto(origin + "/notes/git-rebase-notes", { waitUntil: "networkidle" });
  assert.equal(await page.locator(".article-content").count(), 1);
  assert.match(await page.locator(".article-content").innerText(), /Rebase/);
  assert.equal(await page.locator("article h1").count(), 1, "Article title is the only H1");
  const toc = page.getByRole("navigation", {name:"文章目錄"});
  assert.equal(await toc.locator("a").count(), 4, "Four article headings in navigation");
  const sections = await toc.locator("a").evaluateAll((links) => links.map((a) => {
    const target = document.getElementById(decodeURIComponent(a.hash.slice(1)));
    return {id:decodeURIComponent(a.hash.slice(1)), found:Boolean(target), text:target?.textContent?.trim()};
  }));
  assert.ok(sections.every((x)=>x.found), `Every TOC link should reach an actual heading: ${JSON.stringify(sections)}`);
  assert.equal(sections.filter((s)=>s.id.startsWith("延伸閱讀")).length, 2, "Repeated heading gets unique anchor");
  const progress = page.locator(".article-reading-progress span");
  assert.equal(await progress.count(), 1);
  await toc.locator("a").last().click();
  await page.waitForFunction(() => window.scrollY > 100);
  const scrollPosition = await progress.evaluate((el) => getComputedStyle(el).transform);
  assert.notEqual(scrollPosition, "matrix(0, 0, 0, 1, 0, 0)", "Reading progress advances on scroll");
  console.log("PASS: Markdown headings match accessible TOC links and reading progress advances");

  const codeCopy = page.getByRole("button", {name: "複製程式碼"});
  assert.equal(await codeCopy.count(), 1, "Fenced code exposes one accessible copy action");
  await codeCopy.click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "const answer = 42;");
  assert.ok(await page.getByRole("button", {name: "程式碼已複製"}).isVisible());
  assert.ok(await page.getByRole("link", {name: /回到文章開頭/}).isVisible());
  console.log("PASS: code-block copy and back-to-top navigation");

  assert.ok(await page.locator(".article-content h2").count() >= 1, "Markdown H1 becomes H2");
  assert.ok(await page.locator(".article-content h3").count() >= 1, "Markdown H2 becomes H3");
  const inside = page.locator(".article-content a[href='/about']");
  assert.equal(await inside.getAttribute("target"), null, "Internal link stays in same tab");
  const outside = page.locator(".article-content a[href='https://developer.mozilla.org/']");
  assert.equal(await outside.getAttribute("target"), "_blank");
  assert.match(await outside.getAttribute("rel"), /noopener/);
  const scrollTable = page.getByRole("region", {name: /文章資料表/});
  assert.equal(await scrollTable.getAttribute("tabindex"), "0");
  const scrollDims = await scrollTable.evaluate((el) => ({width:el.clientWidth, full:el.scrollWidth}));
  assert.ok(scrollDims.full > scrollDims.width, `Wide table should be keyboard scrollable: ${JSON.stringify(scrollDims)}`);
  assert.equal(await page.locator('script[type="application/ld+json"]').count(), 0, "No localhost structured URLs");
  console.log("PASS: Markdown heading levels, links and keyboard-scrollable wide table");

  const safeImage = page.locator(".article-content img[alt='架構流程示意圖']");
  assert.equal(await safeImage.count(), 1, "HTTPS image should render with author-provided alt");
  assert.equal(await safeImage.getAttribute("loading"), "lazy");
  assert.equal(await safeImage.getAttribute("decoding"), "async");
  assert.equal(await safeImage.getAttribute("referrerpolicy"), "no-referrer");
  assert.ok(await page.getByText("測試流程圖說明", {exact: true}).isVisible());
  assert.ok(await page.getByText(/圖片無法顯示：請使用 HTTPS/).isVisible());
  assert.equal(await page.locator(".article-content img[src^='http:']").count(), 0,
    "Insecure HTTP images must never be embedded");
  await safeImage.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const img = document.querySelector(".article-content img[alt='架構流程示意圖']");
    return img?.complete && img.naturalWidth === 720;
  });
  assert.ok(syntheticImageRequests >= 1, "Synthetic image was served locally");
  assert.equal(blockedRemoteRequests, 0, "Unsafe image URL did not trigger a request");
  await page.setViewportSize({width: 375, height: 812});
  assert.equal(await toc.locator("a").count(), 4, "TOC still present on phone");
  const mobileTocHeight = await toc.locator("a").first().evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(mobileTocHeight >= 44, `Mobile TOC target too small: ${mobileTocHeight}`);
  await safeImage.scrollIntoViewIfNeeded();
  const imageBounds = await page.evaluate(() => {
    const img = document.querySelector(".article-content img[alt='架構流程示意圖']");
    const content = document.querySelector(".article-content");
    return {
      viewport: innerWidth,
      page: document.documentElement.scrollWidth,
      image: img.getBoundingClientRect().width,
      container: content.getBoundingClientRect().width,
    };
  });
  assert.ok(imageBounds.page <= imageBounds.viewport &&
    imageBounds.image <= imageBounds.container, `Mobile image overflow: ${JSON.stringify(imageBounds)}`);
  await page.screenshot({path: path.join(logDir, "article-image-375.png"), fullPage: true});
  console.log("PASS: HTTPS image lazy load, privacy, caption and 375px responsive display; HTTP image blocked");
  await page.setViewportSize({width:1440, height:900});

  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "切換淺色模式" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.reload({waitUntil:"networkidle"});
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  console.log("PASS: light theme persists after reload");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const animation = await page.locator("#main-content > section").first().evaluate((el) => getComputedStyle(el).animationName);
  assert.equal(animation, "none");
  console.log("PASS: reduced-motion is respected");

  const response = await page.goto(origin + "/studio", { waitUntil: "networkidle" });
  assert.equal(response.status(), 200); // Next follows safe login redirect
  assert.match(page.url(), /\/login(?:\?|$)/);
  assert.ok(await page.getByRole("textbox", { name: "電子郵件" }).isVisible());
  console.log("PASS: unauthenticated visitor cannot access writing desk");

  // Test-only fake login: never a real Supabase project or usable credential.
  await page.getByRole("textbox", { name: "電子郵件" }).fill("offline-studio@example.invalid");
  await page.getByLabel("密碼").fill("synthetic-only-password");
  await page.getByRole("button", { name: /進入工作室/ }).click();
  try {
    await page.waitForURL((url) => url.pathname === "/studio", { timeout: 12000 });
  } catch (error) {
    const messages = await page.locator(".form-error").allInnerTexts();
    throw new Error(`Mock login did not navigate: page=${page.url()}, message=${messages.join("; ")}, error=${error.message}`);
  }
  assert.ok(await page.getByRole("link", { name: /新增筆記/ }).isVisible());
  console.log("PASS: isolated fake admin session reaches studio");

  await page.goto(origin + "/studio/new", { waitUntil: "networkidle" });
  const editor = page.locator("#post-content");
  assert.ok(await editor.isVisible());
  await page.locator("#post-title").fill("手機寫作測試");
  await editor.fill("今天測試 Markdown");
  await editor.evaluate((el) => { el.focus(); el.setSelectionRange(0, 2); });
  await page.getByRole("button", { name: "粗體" }).click();
  assert.equal(await editor.inputValue(), "**今天**測試 Markdown");
  await editor.fill("架構流程");
  await editor.evaluate((el) => { el.focus(); el.setSelectionRange(0, 4); });
  await page.getByRole("button", { name: "圖片" }).click();
  assert.equal(await editor.inputValue(), "![架構流程](https://example.com/image.jpg)");
  await page.waitForFunction(() => {
    const textarea = document.querySelector("#post-content");
    return textarea?.value.slice(textarea.selectionStart, textarea.selectionEnd) === "https://example.com/image.jpg";
  });
  await editor.fill("**今天**測試 Markdown");
  console.log("PASS: image insertion tool selects URL after accessible alt text");

  await page.locator("#post-slug").fill("mobile-backup");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", {name:"下載 .md 備份"}).click(),
  ]);
  assert.equal(download.suggestedFilename(), "mobile-backup.md");
  const backupFile = await readFile(await download.path(), "utf8");
  assert.match(backupFile, /naosledge_backup: 1/);
  assert.match(backupFile, /\*\*今天\*\*測試 Markdown/);
  assert.doesNotMatch(backupFile, /offline-studio@example|synthetic-only-password/);

  await editor.fill("尚未還原的臨時內容");
  page.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /取代目前編輯器/);
    await dialog.dismiss();
  });
  await page.locator("#markdown-backup-file").setInputFiles({
    name:"mobile-backup.md", mimeType:"text/markdown", buffer:Buffer.from(backupFile),
  });
  assert.equal(await editor.inputValue(), "尚未還原的臨時內容", "Cancel must keep current draft");
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await page.locator("#markdown-backup-file").setInputFiles({
    name:"mobile-backup.md", mimeType:"text/markdown", buffer:Buffer.from(backupFile),
  });
  await page.waitForFunction(() =>
    document.querySelector("#post-content")?.value === "**今天**測試 Markdown");
  assert.equal(await page.locator("#post-title").inputValue(), "手機寫作測試");
  assert.equal(await page.locator("#post-slug").inputValue(), "mobile-backup");
  assert.equal(posts.length, 2, "Local Markdown import never writes cloud data");
  console.log("PASS: local Markdown download, cancel-safe import, restore and no cloud write");

  await page.getByRole("button", { name: "文章預覽" }).click();
  assert.match(await page.locator(".editor-md-preview").innerText(), /今天測試/);
  await page.getByRole("button", { name: "返回編輯" }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  const editorDims = await page.evaluate(() => ({
    width: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth,
  }));
  assert.ok(editorDims.html <= editorDims.width && editorDims.body <= editorDims.width,
    `Editor horizontal overflow: ${JSON.stringify(editorDims)}`);
  const mobileTools = await page.locator(".markdown-tool").evaluateAll((buttons) =>
    buttons.map((button) => ({label: button.getAttribute("aria-label"), height: button.getBoundingClientRect().height})));
  assert.equal(mobileTools.length, 7, "All seven Markdown tools should be present");
  assert.ok(mobileTools.every((tool) => tool.height >= 44),
    `Markdown tool touch targets smaller than 44px: ${JSON.stringify(mobileTools)}`);
  const fontSize = await editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(fontSize >= 16, "Mobile editor should not trigger iOS input zoom");
  await page.screenshot({ path: path.join(logDir, "editor-375.png"), fullPage: true });
  console.log("PASS: mobile editor Markdown toolbar, preview and no overflow");

  // Navigate immediately, before the 700ms debounce can complete.
  await editor.fill("快速離開的本機草稿");
  await page.getByRole("link", { name: /返回工作室/ }).click();
  await page.waitForURL((url) => url.pathname === "/studio");
  await page.goto(origin + "/studio/new", { waitUntil: "networkidle" });
  assert.equal(await page.locator("#post-content").inputValue(), "快速離開的本機草稿");
  console.log("PASS: draft survives immediate in-app navigation");

  // Published article drafts are destructive: cancel must not change status.
  await page.goto(origin + "/studio/" + posts[0].id, { waitUntil: "networkidle" });
  const unpublish = page.getByRole("button", { name: "下架為草稿" });
  assert.ok(await unpublish.isVisible());
  page.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /下架/);
    await dialog.dismiss();
  });
  await unpublish.click();
  assert.ok(await page.getByText("已發布", { exact: true }).isVisible());
  console.log("PASS: published-to-draft action is explicit and cancellable");

  // Full Server Action round-trip with synthetic PostgREST memory, never a database.
  await page.goto(origin + "/studio/new", { waitUntil: "networkidle" });
  await page.locator("#post-title").fill("只有本機的測試草稿");
  await page.locator("#post-slug").fill("offline-draft-smoke");
  await page.locator("#post-content").fill("測試一篇不應對匿名訪客公開的草稿內容。");
  await page.getByRole("button", { name: "儲存草稿" }).click();
  await page.waitForURL((url) => url.pathname === "/studio", {timeout: 15000});
  const draft = posts.find((item) => item.slug === "offline-draft-smoke");
  assert.equal(draft?.status, "draft");
  console.log("PASS: fake PostgREST receives a draft via real Server Action");

  const guest = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const guestPage = await guest.newPage();
  let guestResponse = await guestPage.goto(origin + "/notes/offline-draft-smoke", {waitUntil:"networkidle"});
  assert.equal(guestResponse.status(), 404);
  console.log("PASS: anonymous user receives 404 for test draft");

  await page.goto(origin + "/studio/" + draft.id, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /發布文章/ }).click();
  await page.waitForURL((url) => url.pathname === "/studio", {timeout: 15000});
  assert.equal(posts.find((item) => item.id === draft.id)?.status, "published");
  guestResponse = await guestPage.goto(origin + "/notes/offline-draft-smoke", {waitUntil:"networkidle"});
  assert.equal(guestResponse.status(), 200);
  assert.match(await guestPage.locator("h1").innerText(), /本機的測試草稿/);
  console.log("PASS: publish transition becomes readable to anonymous user");

  await guest.close();
  assert.deepEqual(errors, [], `Browser JS errors: ${errors.join("; ")}`);
  console.log("PASS: browser JS error log empty");
  console.log(`Screenshots (temporary, not committed): ${logDir}`);
  await context.close();
} catch (error) {
  console.error("Browser smoke FAILED:", error);
  console.error("Recent Next logs:", nextOutput.slice(-1500));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  child.kill();
  mock.closeAllConnections();
  await new Promise((resolve) => mock.close(resolve));
}
