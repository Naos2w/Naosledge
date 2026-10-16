import test from "node:test";
import assert from "node:assert/strict";
import {
  getPublicSiteOrigin, articleCanonical, articleStructuredData, safeJsonLd,
} from "../lib/seo.ts";

test("only an explicit HTTPS public deployment origin becomes canonical", () => {
  assert.equal(getPublicSiteOrigin("https://naosledge.vercel.app"), "https://naosledge.vercel.app");
  assert.equal(getPublicSiteOrigin(" https://notes.example.tw/ "), "https://notes.example.tw");
  assert.equal(getPublicSiteOrigin("https://www.naosledge.tw"), "https://www.naosledge.tw");
});

test("Vercel preview never produces a public canonical even with HTTPS site URL", () => {
  const previous = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "preview";
    assert.equal(getPublicSiteOrigin("https://www.naosledge.tw"), null);
    assert.equal(getPublicSiteOrigin("https://naosledge-sandbox-preview.vercel.app"), null);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("reject placeholders, localhost, unsafe origins and malformed URLs", () => {
  for (const value of [
    "", " ", "http://localhost:3000", "http://127.0.0.1:3123",
    "https://localhost", "https://127.0.0.1", "https://192.168.1.9",
    "https://example.com", "https://preview.test", "https://any.invalid",
    "https://a.local", "https://thing.localhost", "https://private.example",
    "https://real.tw/page", "https://real.tw/?q=1",
    "https://real.tw/#section", "https://user:pass@real.tw",
    "javascript:alert(1)", "not a URL", "ftp://something.tw",
  ]) assert.equal(getPublicSiteOrigin(value), null, value);
});

test("article canonical encodes path segments and never accepts query fragments unescaped", () => {
  assert.equal(
    articleCanonical("learning-note", "https://notes.example.tw"),
    "https://notes.example.tw/notes/learning-note",
  );
  assert.equal(
    articleCanonical("bad/slug?x", "https://notes.example.tw"),
    "https://notes.example.tw/notes/bad%2Fslug%3Fx",
  );
});

test("article JSON-LD contains only intended public metadata", () => {
  const post = {
    slug: "learning-note", title: "學習筆記", excerpt: "摘要",
    tags: ["Git", "設計"], published_at: "2026-10-15T08:00:00Z",
    updated_at: "2026-10-15T08:30:00Z",
    author_id: "must-not-be-exposed", content_md: "private content field",
  };
  const jsonLd = articleStructuredData(post, "https://notes.example.tw");
  assert.equal(jsonLd["@type"], "BlogPosting");
  assert.equal(jsonLd.mainEntityOfPage, "https://notes.example.tw/notes/learning-note");
  assert.equal(jsonLd.headline, post.title);
  assert.equal(jsonLd.inLanguage, "zh-Hant");
  assert.equal(jsonLd.dateModified, post.updated_at);
  assert.deepEqual(jsonLd.keywords, post.tags);
  assert.equal(JSON.stringify(jsonLd).includes("must-not-be-exposed"), false);
  assert.equal(JSON.stringify(jsonLd).includes("private content field"), false);
});

test("JSON-LD serialization escapes embedded HTML and cannot close its script", () => {
  const json = safeJsonLd({headline: "</script><script>alert('unsafe')</script> & <tag>"});
  assert.equal(json.includes("<"), false);
  assert.equal(json.includes(">"), false);
  assert.equal(json.includes("&"), false);
  assert.equal(JSON.parse(json).headline, "</script><script>alert('unsafe')</script> & <tag>");
});

test("article schema fills description and published date from known public fields", () => {
  const post = {
    slug: "a-post", title: "內容", excerpt: "", tags: [],
    published_at: null, updated_at: "2026-10-15T08:00:00Z",
  };
  const schema = articleStructuredData(post, "https://notes.example.tw");
  assert.equal(schema.description, "內容 - Naosledge");
  assert.equal(schema.datePublished, post.updated_at);
});
