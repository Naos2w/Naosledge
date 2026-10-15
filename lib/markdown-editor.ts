/** Small, deterministic Markdown edits that work without network or editor dependencies. */
export type MarkdownTool = "heading" | "bold" | "italic" | "list" | "link" | "code";

export type MarkdownEdit = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

function boundedSelection(value: string, start: number, end: number) {
  const from = Math.max(0, Math.min(value.length, Math.trunc(start)));
  const to = Math.max(from, Math.min(value.length, Math.trunc(end)));
  return { from, to };
}

/**
 * Formatting keeps the original selection for subsequent typing, and selects a
 * useful placeholder when nothing was selected. Supports IME and mobile touch:
 * the React component restores the returned selection after updating its state.
 */
export function applyMarkdownTool(
  value: string,
  start: number,
  end: number,
  tool: MarkdownTool,
): MarkdownEdit {
  const { from, to } = boundedSelection(value, start, end);
  const selection = value.slice(from, to);
  let before = "";
  let after = "";
  let subject = selection;
  let offset = 0;

  switch (tool) {
    case "heading":
      before = "## ";
      subject ||= "小標題";
      if (from > 0 && value[from - 1] !== "\n") before = "\n" + before;
      if (to < value.length && value[to] !== "\n") after = "\n";
      break;
    case "list":
      // Preserve paragraph boundaries instead of placing "- " in a sentence.
      before = "- ";
      subject ||= "清單項目";
      if (from > 0 && value[from - 1] !== "\n") before = "\n" + before;
      if (selection.includes("\n")) subject = selection.replace(/\n(?=.)/g, "\n- ");
      if (to < value.length && value[to] !== "\n") after = "\n";
      break;
    case "bold":
      before = "**"; after = "**"; subject ||= "重點";
      break;
    case "italic":
      before = "*"; after = "*"; subject ||= "斜體";
      break;
    case "code":
      before = "`"; after = "`"; subject ||= "程式碼";
      if (selection.includes("\n")) {
        before = "```\n"; after = "\n```";
        if (from > 0 && value[from - 1] !== "\n") before = "\n" + before;
        if (to < value.length && value[to] !== "\n") after += "\n";
      }
      break;
    case "link":
      before = "["; after = "](https://example.com)";
      subject ||= "連結文字";
      offset = selection ? subject.length + 2 : 0;
      break;
  }

  const text = value.slice(0, from) + before + subject + after + value.slice(to);
  const selectionStart = from + before.length + offset;
  const selectionEnd = selectionStart + (offset ? "https://example.com".length : subject.length);
  return { text, selectionStart, selectionEnd };
}
