import Link from "next/link";
export default function Footer() {
  return <footer className="footer"><div className="container footer-inner">
    <div className="footer-brand">Naosledge<span>.</span><small>Notes in progress, always.</small></div>
    <p>一個持續修訂中的個人知識索引。</p>
    <div className="footer-links"><Link href="/about">關於</Link><Link href="/studio">管理</Link><a href="#main-content">回到上方 ↑</a></div>
  </div></footer>;
}
