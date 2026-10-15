import type { PostInput } from "./types";

export type PostValidationResult =
  | { ok: true; value: PostInput }
  | { ok: false; error: string };

const UUID_PATTERN = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isPostId(id: unknown): id is string {
  return typeof id === "string" && UUID_PATTERN.test(id);
}

/** Validate untrusted Server Action payloads before any database write. */
export function validatePostInput(input: unknown): PostValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "文章資料格式不正確。" };
  }

  const record = input as Record<string, unknown>;
  const { id, status } = record;
  if (
    typeof record.title !== "string" ||
    typeof record.slug !== "string" ||
    typeof record.excerpt !== "string" ||
    typeof record.content_md !== "string" ||
    typeof record.category !== "string" ||
    typeof record.learned_on !== "string" ||
    !Array.isArray(record.tags) ||
    record.tags.some((tag) => typeof tag !== "string")
  ) {
    return { ok: false, error: "文章資料格式不正確。" };
  }

  if (id !== undefined && !isPostId(id)) {
    return { ok: false, error: "無效的文章 ID。" };
  }

  const title = record.title.trim();
  const slug = record.slug.trim().toLowerCase();
  const excerpt = record.excerpt.trim();
  const content_md = record.content_md;
  const category = record.category.trim() || "筆記";
  const learned_on = record.learned_on;
  // Guard large malicious arrays before deduplication; ordinary use allows <= 12 tags.
  if (record.tags.length > 50) {
    return { ok: false, error: "標籤最多 12 個，每個最多 28 字。" };
  }
  const tags = [...new Set((record.tags as string[]).map((tag) => tag.trim()).filter(Boolean))];

  if (!title || title.length > 160) {
    return { ok: false, error: "標題請填寫 1～160 個字。" };
  }
  if (slug.length < 3 || slug.length > 120 || !SLUG_PATTERN.test(slug)) {
    return { ok: false, error: "文章網址限 3～120 字的小寫英文、數字與連字號。" };
  }
  if (excerpt.length > 400) {
    return { ok: false, error: "摘要不可超過 400 字。" };
  }
  if (content_md.length > 200_000) {
    return { ok: false, error: "文章內容不得超過 200,000 字元。" };
  }
  if (category.length > 36) {
    return { ok: false, error: "分類不可超過 36 字。" };
  }
  if (tags.length > 12 || tags.some((tag) => tag.length > 28)) {
    return { ok: false, error: "標籤最多 12 個，每個最多 28 字。" };
  }

  const date = new Date(`${learned_on}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(learned_on) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== learned_on
  ) {
    return { ok: false, error: "請選擇有效的學習日期。" };
  }
  if (status !== "draft" && status !== "published") {
    return { ok: false, error: "狀態不正確。" };
  }
  if (status === "published" && content_md.trim().length < 10) {
    return { ok: false, error: "發布前請至少輸入 10 個字的正文。" };
  }

  return {
    ok: true,
    value: {
      ...(id === undefined ? {} : { id: id as string }),
      title, slug, excerpt, content_md, category, tags, learned_on, status,
    },
  };
}
