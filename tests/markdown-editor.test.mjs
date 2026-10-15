import test from "node:test";
import assert from "node:assert/strict";
import { applyMarkdownTool } from "../lib/markdown-editor.ts";

test("bold wraps a Chinese/English selection and preserves selection", () => {
  assert.deepEqual(applyMarkdownTool("學到 Git!", 3, 6, "bold"), {
    text: "學到 **Git**!",
    selectionStart: 5,
    selectionEnd: 8,
  });
});

test("bold and italic insert selected placeholders when no text was highlighted", () => {
  assert.deepEqual(applyMarkdownTool("", 0, 0, "bold"), {
    text: "**重點**",
    selectionStart: 2,
    selectionEnd: 4,
  });
  assert.deepEqual(applyMarkdownTool("", 0, 0, "italic"), {
    text: "*斜體*",
    selectionStart: 1,
    selectionEnd: 3,
  });
});

test("heading starts on a fresh line without joining the following sentence", () => {
  assert.deepEqual(applyMarkdownTool("第一段後面", 3, 3, "heading"), {
    text: "第一段\n## 小標題\n後面",
    selectionStart: 7,
    selectionEnd: 10,
  });
  assert.equal(applyMarkdownTool("內容", 0, 2, "heading").text, "## 內容");
});

test("list inserts bullet lines for multiline highlighted paragraphs", () => {
  assert.deepEqual(applyMarkdownTool("甲\n乙", 0, 3, "list"), {
    text: "- 甲\n- 乙",
    selectionStart: 2,
    selectionEnd: 7,
  });
  assert.equal(applyMarkdownTool("一段話", 2, 2, "list").text, "一段\n- 清單項目\n話");
});

test("link selects placeholder URL when a label is already selected", () => {
  const value = applyMarkdownTool("GitHub", 0, 6, "link");
  assert.equal(value.text, "[GitHub](https://example.com)");
  assert.equal(value.text.slice(value.selectionStart, value.selectionEnd), "https://example.com");
});

test("link selects label placeholder when no text is selected", () => {
  const value = applyMarkdownTool("", 0, 0, "link");
  assert.equal(value.text, "[連結文字](https://example.com)");
  assert.equal(value.text.slice(value.selectionStart, value.selectionEnd), "連結文字");
});

test("inline code and multiline fenced code preserve written content", () => {
  assert.deepEqual(applyMarkdownTool("abc", 0, 3, "code"), {
    text: "`abc`", selectionStart: 1, selectionEnd: 4,
  });
  const fenced = applyMarkdownTool("line1\nline2", 0, 11, "code");
  assert.equal(fenced.text, "```\nline1\nline2\n```");
  assert.equal(fenced.text.slice(fenced.selectionStart, fenced.selectionEnd), "line1\nline2");
});

test("selections are bounded to the original text length", () => {
  assert.equal(applyMarkdownTool("abc", -50, 500, "bold").text, "**abc**");
  assert.equal(applyMarkdownTool("abc", 2, 1, "italic").text, "ab*斜體*c");
});

test("formatting does not alter the input variable or surrounding text", () => {
  const text = "開始 中間 結束";
  const change = applyMarkdownTool(text, 3, 5, "bold");
  assert.equal(text, "開始 中間 結束");
  assert.equal(change.text, "開始 **中間** 結束");
});
