import test from "node:test";
import assert from "node:assert/strict";
import {parseObsidianMarkdown,serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {parseMarkdownBackup,serializeMarkdownBackup} from "../lib/markdown-backup.ts";

const draft={
  title:'中文 "原型": 安全',
  slug:"knowledge-security",
  excerpt:"學習驗證\n與摘要",
  category:"技術",
  tags:["Obsidian","Security","資料安全"],
  learned_on:"2026-10-18",
  content_md:"# 私人備忘\n\n[[neon-auth|身分]] 和 [[rls]]\n\n```ts\nconst x=1;\n```",
};

test("Obsidian YAML export roundtrips portable metadata and Wikilinks",()=>{
  const file=serializeObsidianMarkdown(draft);
  assert.match(file,/^---\ntitle: "/);
  assert.match(file,/tags: \["Obsidian","Security","資料安全"\]/);
  assert.match(file,/aliases: \["中文 \\"原型\\": 安全"\]/);
  assert.doesNotMatch(file,/owner_id|session_token|password/);
  const result=parseObsidianMarkdown(file,"knowledge-security.md","2026-10-18");
  assert.deepEqual(result,{content_md:draft.content_md,metadata:{
    title:draft.title,slug:draft.slug,excerpt:draft.excerpt,
    category:draft.category,tags:draft.tags,learned_on:draft.learned_on,
  }});
});

test("common Obsidian block tags and unquoted title restore expected fields",()=>{
  const input=[
    "---",
    "title: Technical Notes",
    "tags:",
    "  - Code",
    "  - \"中文\"",
    "  - Code",
    "category: 學習",
    "date: 2026-10-18",
    "---",
    "",
    "# Notes",
    "A [[link]] without data loss",
  ].join("\n");
  const result=parseObsidianMarkdown(input,"Original.md","2026-10-17");
  assert.equal(result?.metadata.title,"Technical Notes");
  assert.deepEqual(result?.metadata.tags,["Code","中文"]);
  assert.equal(result?.metadata.slug,"technical-notes");
  assert.equal(result?.metadata.learned_on,"2026-10-18");
  assert.equal(result?.content_md,"# Notes\nA [[link]] without data loss");
});

test("Chinese filename fallback uses stable valid identifier",()=>{
  const input="---\ntags: [\"安全\"]\n---\n\n正文";
  const first=parseObsidianMarkdown(input,"我學會了.md","2026-10-17");
  const second=parseObsidianMarkdown(input,"我學會了.md","2026-10-17");
  assert.equal(first?.metadata.title,"我學會了");
  assert.match(first?.metadata.slug||"",/^obsidian-[0-9a-f]{8}$/);
  assert.equal(first?.metadata.slug,second?.metadata.slug);
  assert.equal(first?.content_md,"正文");
});

test("BOM, CRLF and YAML-safe quotes are supported without executing frontmatter",()=>{
  const input="\uFEFF---\r\ntitle: 'It''s Obsidian'\r\ntags: [\"A\"]\r\n---\r\n\r\n[[wikilink]]";
  const parsed=parseObsidianMarkdown(input,"any.md","2026-10-18");
  assert.equal(parsed?.metadata.title,"It's Obsidian");
  assert.equal(parsed?.content_md,"[[wikilink]]");
});

test("unknown or unsafe frontmatter remains plain Markdown; never silently drop data",()=>{
  const input=[
    "---","title: Original","aliases: [\"Do not drop me\"]","tags: [\"Safe\"]",
    "---","","## Body","[[target]]",
  ].join("\n");
  assert.equal(parseObsidianMarkdown(input,"Original.md","2026-10-18"),null);
  assert.deepEqual(parseMarkdownBackup(input),{content_md:input});
  for(const raw of [
    "---\ntitle: !include evil.yaml\n---\n\n# data",
    "---\ntitle: &anchor foo\n---\n\n# data",
    "---\ntitle: ok\ntitle: another\n---\n\n# data",
    "---\ntitle: ok\ntags: [\"ok\", 3]\n---\n\n# data",
    "---\ntitle: ok\ndate: 2026-02-30\n---\n\n# data",
    "---\ntitle: ok\nnaosledge_slug: ../secret\n---\n\n# data",
    '---\ntitle: ok\naliases: ["something else"]\n---\n\n# data',
    "---\nfoo: bar\n---\n\n# body",
  ])assert.equal(parseObsidianMarkdown(raw,"test.md","2026-10-18"),null,raw);
});

test("existing Naosledge backup takes precedence and remains unchanged",()=>{
  const own=serializeMarkdownBackup(draft);
  assert.equal(parseObsidianMarkdown(own,"knowledge.md","2026-10-18"),null);
  assert.equal(parseMarkdownBackup(own).content_md,draft.content_md);
});

test("limits prevent oversized body, thousands of tags or malformed dates",()=>{
  const large="---\ntitle: A\n---\n\n"+"x".repeat(200001);
  assert.equal(parseObsidianMarkdown(large,"file.md","2026-10-18"),null);
  const tags=Array.from({length:13},(_,i)=>"tag"+i);
  assert.equal(parseObsidianMarkdown(
    '---\ntitle: A\ntags: '+JSON.stringify(tags)+'\n---\n\nBody',
    "file.md","2026-10-18"),null);
  assert.equal(parseObsidianMarkdown(null,"file.md","2026-10-18"),null);
  assert.equal(parseObsidianMarkdown("no frontmatter","file.md","2026-10-18"),null);
});
