import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeMarkdownImageSrc } from "@/lib/markdown-image";
import { remarkHeadingAnchors } from "@/lib/article-outline";
import CodeSnippet from "@/components/code-snippet";

export default function Markdown({content}: {content:string}) {
  return <div className="markdown-body">
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkHeadingAnchors]}
      components={{
        // The article title is the page's only H1.
        h1: ({children, id}) => <h2 id={id}>{children}</h2>,
        h2: ({children, id}) => <h3 id={id}>{children}</h3>,
        h3: ({children, id}) => <h4 id={id}>{children}</h4>,
        h4: ({children, id}) => <h5 id={id}>{children}</h5>,
        h5: ({children, id}) => <h6 id={id}>{children}</h6>,
        h6: ({children, id}) => <h6 id={id}>{children}</h6>,
        // Keep internal references in the current tab; external ones are explicit.
        a: ({children, href}) => {
          const external = href?.startsWith("https://") || href?.startsWith("http://");
          return <a href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            title={external ? "在新分頁開啟連結" : undefined}>{children}</a>;
        },
        table: ({children}) => <div className="markdown-table-scroll" role="region"
          aria-label="文章資料表（可左右捲動）" tabIndex={0}><table>{children}</table></div>,
        pre: ({children}) => <CodeSnippet>{children}</CodeSnippet>,
        img: ({src, alt, title}) => {
          const safeSrc = safeMarkdownImageSrc(src);
          if (!safeSrc) return <span className="markdown-image-unavailable" role="img"
            aria-label={alt || "圖片無法顯示"}>圖片無法顯示：請使用 HTTPS 或站內圖片網址。</span>;
          return <span className="markdown-image-block">
            <img src={safeSrc} alt={alt ?? ""} loading="lazy" decoding="async"
              referrerPolicy="no-referrer"/>
            {title && <small className="markdown-image-caption">{title}</small>}
          </span>;
        },
      }}>
      {content}
    </ReactMarkdown>
  </div>;
}
