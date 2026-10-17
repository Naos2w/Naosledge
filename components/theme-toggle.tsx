"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    let preferred: string | null = null;
    try { preferred = localStorage.getItem("naosledge-theme") ?? localStorage.getItem("learnlog-theme"); } catch { /* private browser policy */ }
    const nextDark = preferred === "light" ? false : true;
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    setDark(nextDark);
  }, []);
  function toggle() {
    const nextDark = !dark;
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    try { localStorage.setItem("naosledge-theme", nextDark ? "dark" : "light"); } catch { /* policy may block storage */ }
    setDark(nextDark);
  }
  return <button type="button" className="icon-button" onClick={toggle} aria-label={dark ? "切換淺色模式" : "切換深色模式"} title="切換明暗主題">
    {dark ? <Sun size={18}/> : <Moon size={18}/>}
  </button>;
}
