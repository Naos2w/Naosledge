import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, Heading } from "mdast";

export type ArticleSection = { id: string; title: string; level: number };

/** Stable Unicode anchors for Chinese and English titles, with duplicate handling. */
export function headingAnchor(label: string): string {
  return label.normalize("NFKC").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim().replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 80) || "section";
}

type TextNode = { type: string; value?: string; alt?: string; children?: TextNode[] };

function plainHeadingText(node: TextNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (node.type === "image") return node.alt ?? "";
  return node.children?.map(plainHeadingText).join("") ?? "";
}

/**
 * Shared by the article outline and ReactMarkdown's remark pipeline.
 * IDs are attached to the Markdown AST, not derived from page DOM timing.
 */
export function assignHeadingIds(tree: Root): ArticleSection[] {
  const used = new Set<string>();
  const result: ArticleSection[] = [];
  for (const node of tree.children) {
    if (node.type !== "heading") continue;
    const heading = node as Heading;
    const title = heading.children.map((part) => plainHeadingText(part as TextNode))
      .join("").trim() || "未命名段落";
    const base = headingAnchor(title);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${base}-${suffix++}`;
    used.add(candidate);

    heading.data = { ...heading.data, hProperties: { ...heading.data?.hProperties, id: candidate } };
    if (heading.depth <= 3) result.push({id: candidate, title, level: heading.depth});
  }
  return result;
}

export function articleOutline(markdown: string): ArticleSection[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  return assignHeadingIds(tree);
}

export const remarkHeadingAnchors: Plugin<[], Root> = () => (tree) => {
  assignHeadingIds(tree);
};
