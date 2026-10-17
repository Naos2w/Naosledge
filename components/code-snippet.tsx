"use client";

import { useRef, useState, type ReactNode } from "react";
import { Check, Clipboard, AlertCircle } from "lucide-react";

export default function CodeSnippet({children}: {children:ReactNode}) {
  const preRef = useRef<HTMLPreElement>(null);
  const [state, setState] = useState<"idle"|"copied"|"error">("idle");

  async function copyCode() {
    const text = preRef.current?.textContent?.replace(/\n$/, "") ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("error");
    }
  }

  return <div className="code-snippet">
    <button type="button" onClick={copyCode}
      className="code-copy" aria-live="polite"
      aria-label={state==="copied"?"程式碼已複製":state==="error"?"無法複製程式碼":"複製程式碼"}>
      {state==="copied"? <Check size={14} aria-hidden="true"/> :
        state==="error"? <AlertCircle size={14} aria-hidden="true"/> :
        <Clipboard size={14} aria-hidden="true"/>}
      <span>{state==="copied"?"已複製":state==="error"?"複製失敗":"複製"}</span>
    </button>
    <pre ref={preRef}>{children}</pre>
  </div>;
}
