import Link from "next/link";
import { ArrowUpRight, PenLine } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";
import MobileNav from "@/components/mobile-nav";
import {privateVaultPreviewIntent} from "@/lib/neon/vault-preview";

export default function Nav() {
  if(privateVaultPreviewIntent(process.env))return <header className="site-header">
    <div className="site-header-inner container">
      <Link href="/vault" className="brand" aria-label="Naosledge 私人知識庫">
        <span className="brand-mark" aria-hidden="true">N<span className="brand-mark-slash">/</span></span>
        <span className="brand-name">Naosledge<span className="brand-name-dot">.</span></span>
        <span className="brand-descriptor">PRIVATE VAULT PREVIEW</span>
      </Link>
      <nav className="primary-nav" aria-label="私人驗收">
        <Link href="/vault">私人筆記</Link>
        <Link href="/vault/graph">知識網絡</Link>
      </nav>
      <div className="header-actions"><ThemeToggle/></div>
    </div>
  </header>;
  return <header className="site-header">
    <div className="site-header-inner container">
      <Link href="/" className="brand" aria-label="Naosledge 首頁">
        <span className="brand-mark" aria-hidden="true">N<span className="brand-mark-slash">/</span></span>
        <span className="brand-name">Naosledge<span className="brand-name-dot">.</span></span>
        <span className="brand-descriptor">個人知識日誌</span>
      </Link>
      <nav className="primary-nav" aria-label="主選單">
        <Link href="/#archive">文章索引</Link>
        <Link href="/#timeline">學習足跡</Link>
        <Link href="/about">關於</Link>
      </nav>
      <div className="header-actions">
        <ThemeToggle/>
        <Link href="/studio" className="header-admin" aria-label="寫筆記"><PenLine size={15}/><span>寫筆記</span><ArrowUpRight size={14}/></Link>
        <MobileNav/>
      </div>
    </div>
  </header>;
}
