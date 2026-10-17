import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { formatDate, readingMinutes } from "@/lib/format";
import type { Post } from "@/lib/types";

export default function PostCard({post,index=0}: {post:Post;index?:number;featured?:boolean}) {
  return <article className="index-row">
    <div className="index-number">{String(index+1).padStart(2,"0")}</div>
    <Link href={`/notes/${post.slug}`} className="index-entry" aria-label={`閱讀文章：${post.title}`}>
      <div className="index-meta"><span>{formatDate(post.learned_on)}</span><span className="meta-divider">/</span><span>{post.category || "未分類"}</span>{index===0&&<span className="recent-label">最近更新</span>}</div>
      <div className="index-entry-content"><div><h3>{post.title}</h3><p>{post.excerpt || post.content_md.slice(0,120)}</p></div><span className="index-arrow" aria-hidden="true"><ArrowUpRight size={23} strokeWidth={1.5}/></span></div>
      <div className="index-foot"><span className="index-tags">{post.tags.slice(0,4).map((tag)=><span key={tag}>#{tag}</span>)}</span><span className="index-reading"><Clock3 size={13}/> {readingMinutes(post.content_md)} 分鐘</span></div>
    </Link>
  </article>;
}
