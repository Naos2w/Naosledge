# Naosledge v3 — Minimal Dark Liquid Glass

## Design read

繁體中文個人公開知識部落格與站長寫作工具。**編輯式資訊架構 + 現代極簡深色 + 可控制的液態玻璃光感**。拒絕 AI 模板式 SaaS Dashboard。預設深色、提供可持久保存的淺色切換。

採用 MSI 上的 `ui-ux-pro-max` 搜尋與 `design-director`、`design-taste-frontend`、`motion-design` 規範。資料層、安全與發布流程不因視覺更新而改動。

## Design Tokens

| Token | Dark（default） | Light（optional） |
|---|---|---|
| `--paper` | `#080B12` | `#F5F7FB` |
| `--sheet` | `#111720` | `#FFFFFF` |
| `--ink` | `#F3F6FC` | `#172230` |
| `--ink-soft` | `#B7C2D0` | `#47586B` |
| `--accent` | `#B8DAFE` | `#315D8B` |
| `--glass` | `rgba(25,33,48,.55)` | `rgba(255,255,255,.64)` |
| `--glass-line` | `rgba(220,235,255,.17)` | `rgba(70,105,151,.20)` |

Source of truth: `app/glass.css` (loaded after original `globals.css`). The offline preview builder concatenates these exact production styles instead of maintaining a divergent copy.

## Glass Surface Hierarchy

1. **Level 1 — Global navigation:** floating 24px backdrop blur, translucent header, top highlight and thin rim.
2. **Level 2 — Interaction & discovery:** one featured notebook object, search capsule, activity panels, editor publishing sidebar.
3. **Level 3 — Content:** article body/editor manuscript use **solid surfaces** with comfortable contrast; no glass under long reading passages.

Do not layer every section in glass or add large glowing gradient blobs. Web implementation approximates Liquid Glass via CSS rather than native Apple material.

## Motion Identity

- Personality: **Premium calm** with easing `cubic-bezier(.22,1,.36,1)` for spatial motion.
- Micro feedback: 120–250ms (press/toggle), cards and glass surfaces 250–550ms, initial section entrance ~580–700ms.
- Property priority: transform and opacity; no scroll hijacking, constant parallax, or high-cost filters inside animation loops.
- Focus outlines remain visible; `prefers-reduced-motion:reduce` disables entrance and glow pulse.
- `prefers-reduced-transparency:reduce` and backdrop-filter unsupported → opaque fallback.

## Usage

- Dark is the first-visit default, independent of OS mode. The explicitly chosen value is saved as `naosledge-theme`; old `learnlog-theme` is read for backward compatibility.
- Server starts with `data-theme="dark"`; early inline theme selection prevents a flash for returning light-theme readers.
- Preview uses a separate `naosledge-v3-preview-theme` key and is not a real Supabase deployment.

## Responsive & Accessibility

- Responsive references: 375, 768, 1024 and 1440px.
- Text-first archive and compact, single-column mobile reading; no horizontal scrolling.
- Mobile minimum button/chip interaction sizes target 44px; text inputs ≥16px to prevent iOS Safari zoom.
- Respect screen readers, keyboard focus and adequate article contrast. Production Lighthouse and assistive-technology audits remain pending.
