import test from "node:test";
import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { articleOutline, assignHeadingIds, headingAnchor } from "../lib/article-outline.ts";

test("Chinese and English headings get consistent bookmark-safe IDs", () => {
  assert.equal(headingAnchor("  學習 Git Rebase？ "), "學習-git-rebase");
  assert.equal(headingAnchor("⚡ 2026 / C++"), "2026-c");
  assert.equal(headingAnchor("  "), "section");
});

test("headings in fenced code blocks do not become navigation items", () => {
  const sections = articleOutline([
    "# 本文",
    "一些文字",
    "```markdown",
    "## 這是示範碼，不是章節",
    "```",
    "## 重點",
    "### 範例",
  ].join("\n"));
  assert.deepEqual(sections, [
    {id:"本文", title:"本文", level:1},
    {id:"重點", title:"重點", level:2},
    {id:"範例", title:"範例", level:3},
  ]);
});

test("two identical headings get different IDs without colliding with existing suffixes", () => {
  const sections = articleOutline("# 重點\n\n## 重點\n\n## 重點-2\n\n## 重點");
  assert.deepEqual(sections.map(x=>x.id), ["重點", "重點-2", "重點-2-2", "重點-3"]);
});

test("Markdown AST and outline share exactly the same IDs", () => {
  const markdown = [
    "# **重要** 設計",
    "## [參考](https://example.org) 和 `Code`",
    "### 包含 ![架構圖](/images/fig.png) 的標題",
    "#### 更深層的說明",
    "分段內容",
    "",
    "Setext 章節",
    "-------------",
  ].join("\n");
  const tree = unified().use(remarkParse).parse(markdown);
  const sections = assignHeadingIds(tree);
  const allHeaders = tree.children.filter(x=>x.type==="heading");
  assert.deepEqual(
    allHeaders.slice(0,3).map(h=>h.data?.hProperties?.id),
    sections.slice(0,3).map(x=>x.id),
  );
  assert.ok(allHeaders.every(x=>typeof x.data?.hProperties?.id==="string"));
  assert.deepEqual(sections.map(x=>x.title), [
    "重要 設計",
    "參考 和 Code",
    "包含 架構圖 的標題",
    "Setext 章節",
  ]);
  assert.deepEqual(articleOutline(markdown), sections);
});

test("outline skips headings deeper than H3 but still assigns linkable IDs", () => {
  const tree = unified().use(remarkParse).parse("#### 小項目\n\n##### 內文\n\n###### 補充");
  assert.deepEqual(assignHeadingIds(tree), []);
  assert.deepEqual(tree.children.map(h=>h.data?.hProperties?.id), ["小項目", "內文", "補充"]);
});

test("empty headings produce unique stable fallback sections", () => {
  assert.deepEqual(articleOutline("#\n\n##\n\n#").map(x=>x.id), ["未命名段落", "未命名段落-2", "未命名段落-3"]);
});

test("GFM headings are parsed with inline formatting and safe Unicode anchors", () => {
  const headings = articleOutline("# **Hello**, 世界!\n\n## `TypeScript` 速查");
  assert.deepEqual(headings.map(h=>h.id), ["hello-世界", "typescript-速查"]);
});
