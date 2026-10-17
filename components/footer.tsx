import Link from "next/link";
import {privateVaultPreviewIntent} from "@/lib/neon/vault-preview";
export default function Footer() {
  if(privateVaultPreviewIntent(process.env))return <footer className="footer"><div className="container footer-inner">
    <div className="footer-brand">Naosledge<span>.</span><small>Private acceptance only</small></div>
    <p>受保護的私人知識庫驗收，不提供公開文章發布。</p>
    <div className="footer-links"><Link href="/vault">私人知識庫</Link><Link href="/vault/graph">知識網絡</Link></div>
  </div></footer>;
  return <footer className="footer"><div className="container footer-inner">
    <div className="footer-brand">Naosledge<span>.</span><small>Notes in progress, always.</small></div>
    <p>一個持續修訂中的個人知識索引。</p>
    <div className="footer-links"><Link href="/about">關於</Link><Link href="/studio">管理</Link><a href="#main-content">回到上方 ↑</a></div>
  </div></footer>;
}
