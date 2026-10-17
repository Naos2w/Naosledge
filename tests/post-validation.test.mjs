import test from "node:test";
import assert from "node:assert/strict";
import { isPostId, validatePostInput } from "../lib/post-validation.ts";

const valid = {
  title: "Git rebase 筆記",
  slug: "git-rebase",
  excerpt: "今天的整理",
  content_md: "## 今日所學\n\n這是完整的知識筆記內容。",
  category: "技術",
  tags: ["Git", "筆記"],
  learned_on: "2026-10-15",
  status: "published",
};
const check = (changes = {}) => validatePostInput({ ...valid, ...changes });
const rejected = (result, fragment) => {
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(fragment));
};

test("valid post is normalized without changing the original input", () => {
  const input = { ...valid, title: "  Git rebase 筆記 ", slug: "  Git-Rebase  ", category: " ", tags: [" Git ", "", "Git", "筆記"] };
  const result = validatePostInput(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    ...valid,
    title: "Git rebase 筆記",
    slug: "git-rebase",
    category: "筆記",
    tags: ["Git", "筆記"],
  });
  assert.equal(input.title, "  Git rebase 筆記 ");
});

test("draft can be saved with empty body", () => {
  const result = check({ status: "draft", content_md: "" });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, "draft");
});

test("published article requires at least ten non-whitespace characters", () => {
  rejected(check({ content_md: "abc  " }), "10");
  assert.equal(check({ content_md: "1234567890" }).ok, true);
});

test("untrusted payload types are rejected instead of throwing", () => {
  const candidates = [
    null, undefined, 0, true, "hello", [], {},
    { ...valid, title: null },
    { ...valid, slug: ["valid-slug"] },
    { ...valid, tags: "Git" },
    { ...valid, tags: ["Git", null] },
    { ...valid, content_md: { text: "fake" } },
    { ...valid, id: null },
  ];
  for (const candidate of candidates) {
    assert.doesNotThrow(() => validatePostInput(candidate));
    rejected(validatePostInput(candidate), "格式|ID");
  }
});

test("title cannot be blank or longer than 160 characters", () => {
  rejected(check({ title: " " }), "標題");
  rejected(check({ title: "x".repeat(161) }), "標題");
  assert.equal(check({ title: "x".repeat(160) }).ok, true);
});

test("slug must be short, lowercase-normalizable and safely URL shaped", () => {
  for (const slug of ["ab", "-leading", "trailing-", "double--dash", "bad/path", "空白", "ab c", "x".repeat(121)]) {
    rejected(check({ slug }), "文章網址");
  }
  assert.equal(check({ slug: "MY-LEARNING-NOTE" }).value.slug, "my-learning-note");
  assert.equal(check({ slug: "a".repeat(120) }).ok, true);
});

test("excerpt, content and category lengths are bounded", () => {
  rejected(check({ excerpt: "x".repeat(401) }), "摘要");
  rejected(check({ content_md: "x".repeat(200_001) }), "200,000");
  rejected(check({ category: "x".repeat(37) }), "分類");
  assert.equal(check({ excerpt: "x".repeat(400) }).ok, true);
});

test("tags have a strict count and length limit", () => {
  rejected(check({ tags: Array.from({ length: 13 }, (_, i) => `tag-${i}`) }), "12");
  rejected(check({ tags: ["x".repeat(29)] }), "28");
  rejected(check({ tags: Array.from({ length: 51 }, () => "dupe") }), "12");
  assert.equal(check({ tags: Array.from({ length: 12 }, (_, i) => `tag-${i}`) }).ok, true);
});

test("calendar dates must be actual ISO dates including leap days", () => {
  for (const learned_on of ["2026-02-29", "2026-13-01", "2026-00-10", "not-a-date", "2026-1-1", "2026-01-32"]) {
    rejected(check({ learned_on }), "日期");
  }
  assert.equal(check({ learned_on: "2024-02-29" }).ok, true);
});

test("status must be a known draft or published value", () => {
  rejected(check({ status: "deleted" }), "狀態");
  rejected(check({ status: null }), "狀態");
});

test("post ID uses the correct UUID layout", () => {
  const good = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(isPostId(good), true);
  assert.equal(check({ id: good }).ok, true);
  for (const id of ["", "aaaaaaaa-aaaa-aaaa-aaaa-aaaa", "x".repeat(36), 42]) {
    assert.equal(isPostId(id), false);
    rejected(check({ id }), "ID");
  }
});
