import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Markdown({content}: {content:string}) {
  return <div className="markdown-body">
    <ReactMarkdown remarkPlugins={[remarkGfm]}
      components={{
        // The article title is the page's only H1.
        h1: ({children}) => <h2>{children}</h2>,
        h2: ({children}) => <h3>{children}</h3>,
        h3: ({children}) => <h4>{children}</h4>,
        h4: ({children}) => <h5>{children}</h5>,
        h5: ({children}) => <h6>{children}</h6>,
        h6: ({children}) => <h6>{children}</h6>,
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
      }}>
      {content}
    </ReactMarkdown>
  </div>;
}
