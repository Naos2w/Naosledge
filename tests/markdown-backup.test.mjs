import test from "node:test";
import assert from "node:assert/strict";
import {
  markdownBackupFilename, parseMarkdownBackup, serializeMarkdownBackup,
} from "../lib/markdown-backup.ts";

const draft = {
  title: "我的 Git 學習筆記",
  slug: "git-learning",
  excerpt: "「引用」與特殊字元 \" \\",
  category: "技術",
  tags: ["Git", "TypeScript"],
  learned_on: "2026-10-15",
  content_md: "# 當天筆記\n\n這裡包含 Markdown 與第二行。\n\n```js\nconst x = 42;\n```",
};

test("backup exports portable Markdown and restores all intended fields", () => {
  const saved = serializeMarkdownBackup(draft);
  assert.ok(saved.startsWith("---\nnaosledge_backup: 1\n"));
  assert.match(saved, /title: "我的 Git 學習筆記"/);
  assert.doesNotMatch(saved, /^content_md:/m);
  assert.deepEqual(parseMarkdownBackup(saved), {
    content_md: draft.content_md,
    metadata: {
      title: draft.title,
      slug: draft.slug,
      excerpt: draft.excerpt,
      category: draft.category,
      tags: draft.tags,
      learned_on: draft.learned_on,
    },
  });
  assert.doesNotMatch(saved, /password|service_role|user_id/);
});

test("plain Markdown with unrecognized frontmatter is preserved without modification", () => {
  const generic = "---\nfoo: bar\n---\n\n# Hello\n\nbody";
  assert.deepEqual(parseMarkdownBackup(generic), {content_md: generic});
});

test("plain Markdown with BOM and CRLF can be imported", () => {
  assert.deepEqual(parseMarkdownBackup("\uFEFF# 中文\r\n\r\n測試"), {
    content_md: "# 中文\n\n測試",
  });
});

test("a valid saved backup with Windows line endings imports as expected", () => {
  const windows = serializeMarkdownBackup(draft).replaceAll("\n","\r\n");
  assert.deepEqual(parseMarkdownBackup(windows).metadata?.tags, ["Git", "TypeScript"]);
});

test("malformed or oversized backups are rejected safely", () => {
  for (const value of [null, undefined, "", " ", 12, "# x".repeat(100_001)]) {
    assert.throws(() => parseMarkdownBackup(value), /空的|太大|超過/);
  }
  const malformed = serializeMarkdownBackup(draft).replace('slug: "git-learning"', "slug: nope!");
  assert.throws(() => parseMarkdownBackup(malformed), /無法解析/);
  const invalid = serializeMarkdownBackup(draft).replace('slug: "git-learning"', 'slug: "a / b"');
  assert.throws(() => parseMarkdownBackup(invalid), /欄位格式/);
});

test("backup filenames are safe and stable", () => {
  assert.equal(markdownBackupFilename(draft.title, draft.slug), "git-learning.md");
  assert.equal(markdownBackupFilename("Git & TypeScript", "../unsafe"), "git-typescript.md");
  assert.equal(markdownBackupFilename("中文", ""), "naosledge-note.md");
});
