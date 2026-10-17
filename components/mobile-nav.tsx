"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";

/** Native details/summary keeps mobile navigation keyboard and screen-reader friendly. */
export default function MobileNav() {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const close = () => { if (menuRef.current) menuRef.current.open = false; };

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  return <details className="mobile-menu" ref={menuRef}
    onKeyDown={(event) => {
      if (event.key === "Escape" && menuRef.current?.open) {
        event.preventDefault();
        close();
        menuRef.current?.querySelector("summary")?.focus();
      }
    }}>
    <summary className="icon-button mobile-menu-trigger" aria-label="開啟導覽選單" title="網站導覽">
      <Menu size={18} aria-hidden="true"/>
    </summary>
    <nav className="mobile-menu-panel" aria-label="手機主選單">
      <Link href="/#archive" onClick={close}>文章索引</Link>
      <Link href="/#timeline" onClick={close}>學習足跡</Link>
      <Link href="/about" onClick={close}>關於 Naosledge</Link>
    </nav>
  </details>;
}
