import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Markdown({content}: {content:string}) {
  return <div className="markdown-body">
    <ReactMarkdown remarkPlugins={[remarkGfm]}
      components={{
        a: ({children, href}) => <a href={href} rel="noopener noreferrer" target="_blank">{children}</a>,
      }}>
      {content}
    </ReactMarkdown>
  </div>;
}
