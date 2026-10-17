export type MarkdownBackupDraft = {
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  tags: string[];
  learned_on: string;
  content_md: string;
};

type BackupFields = Omit<MarkdownBackupDraft, "content_md">;
export type ImportedMarkdown = {content_md: string; metadata?: BackupFields};

const MAX_MARKDOWN_LENGTH = 200_000;
const FIELD_NAMES = ["title", "slug", "excerpt", "category", "tags", "learned_on"] as const;

/** Plain portable Markdown with a small, JSON-safe YAML frontmatter header. */
export function serializeMarkdownBackup(draft: MarkdownBackupDraft): string {
  const lines = ["---", "naosledge_backup: 1"];
  for (const key of FIELD_NAMES) {
    lines.push(`${key}: ${JSON.stringify(draft[key])}`);
  }
  return lines.join("\n") + "\n---\n\n" + draft.content_md;
}

export function markdownBackupFilename(title: string, slug: string): string {
  const stem = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 90
    ? slug : title.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "naosledge-note";
  return `${stem}.md`;
}

/**
 * Reads a Naosledge backup (metadata+body) or a generic .md file (body only).
 * Importing never changes cloud status, permissions, or article ID.
 */
export function parseMarkdownBackup(input: unknown): ImportedMarkdown {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Markdown 檔案是空的。");
  }
  if (input.length > MAX_MARKDOWN_LENGTH + 50_000) {
    throw new Error("Markdown 備份檔太大。");
  }
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n(?:\n)?/);
  const marker = frontmatter?.[1].split("\n").some((line) => line === "naosledge_backup: 1");

  if (!frontmatter || !marker) {
    if (text.length > MAX_MARKDOWN_LENGTH) throw new Error("文章內容不得超過 200,000 字元。");
    return {content_md: text};
  }

  const metadata: Record<string, unknown> = {};
  try {
    for (const line of frontmatter[1].split("\n")) {
      if (line === "naosledge_backup: 1") continue;
      const pair = line.match(/^([a-z_]+): (.+)$/);
      if (!pair || !(FIELD_NAMES as readonly string[]).includes(pair[1])) {
        throw new Error("unrecognized backup field");
      }
      if (Object.hasOwn(metadata, pair[1])) throw new Error("duplicate backup field");
      metadata[pair[1]] = JSON.parse(pair[2]);
    }
  } catch {
    throw new Error("Naosledge 備份檔的文章資訊無法解析。");
  }

  const strings = ["title", "slug", "excerpt", "category", "learned_on"] as const;
  if (
    strings.some((key) => typeof metadata[key] !== "string") ||
    !Array.isArray(metadata.tags) || metadata.tags.some((tag: unknown) => typeof tag !== "string") ||
    (metadata.title as string).length > 160 || (metadata.excerpt as string).length > 400 ||
    (metadata.category as string).length > 36 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.slug as string) ||
    (metadata.slug as string).length > 120 ||
    (metadata.tags as string[]).length > 12 ||
    (metadata.tags as string[]).some((tag) => tag.length > 28) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(metadata.learned_on as string)
  ) {
    throw new Error("Naosledge 備份檔的欄位格式不正確。");
  }
  const content_md = text.slice(frontmatter[0].length);
  if (content_md.length > MAX_MARKDOWN_LENGTH) {
    throw new Error("文章內容不得超過 200,000 字元。");
  }
  return {content_md, metadata: metadata as BackupFields};
}
