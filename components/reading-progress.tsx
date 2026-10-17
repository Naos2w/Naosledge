"use client";

import { useEffect, useRef } from "react";

/**
 * A tiny transform-only indicator. Scroll events do not trigger React renders,
 * and layout is re-measured only when the article or viewport changes.
 */
export default function ReadingProgress() {
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const article = document.querySelector<HTMLElement>(".article-page");
    const bar = barRef.current;
    if (!article || !bar) return;

    let start = 0;
    let distance = 1;
    let frame = 0;

    const update = () => {
      frame = 0;
      const progress = Math.max(0, Math.min(1, (window.scrollY - start) / distance));
      bar.style.transform = `scaleX(${progress})`;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const measure = () => {
      start = window.scrollY + article.getBoundingClientRect().top;
      distance = Math.max(1, article.offsetHeight - window.innerHeight);
      bar.style.opacity = article.offsetHeight > window.innerHeight ? "1" : "0";
      schedule();
    };

    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(measure) : null;
    observer?.observe(article);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    measure();

    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <div className="article-reading-progress" aria-hidden="true">
    <span ref={barRef}/>
  </div>;
}
