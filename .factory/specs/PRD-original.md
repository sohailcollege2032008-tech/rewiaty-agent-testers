# PRD الأصلي من سهيل (2026-11-24) — نسخة زي ما هي
> ملاحظة سهيل: «غالبا ناقصها شوية حاجات بس ده حاجة مبدأية». والـ PRD مكتوب لـ React web + Vite، **والقرار: React Native (Expo)**.
> الترتيب المعتمد للنطاق في `.factory/VISION.md`.

Act as a Senior Frontend Engineer & Digital Typography Specialist. Build a sleek, offline-first, distraction-free Digital Novel Reader (originally: React + TypeScript + Tailwind CSS + Vite) designed specifically to render long-form novels from structured Markdown (`.md`) files with book-grade typography and native Arabic (RTL + Tashkeel/Diacritics) & English (LTR) support.

### 1. Core Markdown Novel Schema & Parser
Support uploading any `.md` file (plus a built-in rich Arabic sample novel with full Tashkeel):
- **YAML Frontmatter** (`title`, `author`, `lang`, `dir`, `coverColor`): elegant Title Page; sets `dir="rtl"`/`"ltr"` automatically (with manual override).
- **Chapters (`# Heading 1`)**: populate a slide-out TOC drawer. In Paginated Mode every `#` chapter MUST force a clean page break with ornamental chapter spacing.
- **Sub-headings (`##`)**: subtle scene/part headers.
- **Scene Breaks (`***` or `---`)**: centered ornamental dividers (`✦  ✦  ✦`). The first paragraph after a `#` heading or scene break MUST have `text-indent: 0`.
- **Letters / Flashbacks / Notes (`>` Blockquotes)**: inset parchment/quote cards, subtle borders, distinct styling.
- **Dialogue Enhancement (Optional Toggle)**: lines starting with `—`, `-`, or containing `«...»` / `"..."` get subtle spacing or gentle tinting.
- **Footnotes**: `[^1]` as tap-to-view popovers.

### 2. Dual Reading Engine
1. **True Paginated Mode (Default)**: CSS Multi-Column pagination (`column-width`, `column-gap`, `height: 100%`) that reflows on font size/margins/viewport change without slicing a line vertically. Keep reading position (percentage/paragraph anchor) on resize or typography change. Navigation: tap left/right edges (RTL: Left = Next, Right = Previous), swipe, wheel, Arrow keys. Immersive HUD: tapping the center 40% toggles header (title/TOC/Settings) + footer (page X / Y, chapter progress, scrubber).
2. **Smooth Vertical Scroll Mode** with chapter progress tracking and optional progress bar.

### 3. Arabic & Typography Safeguards (Non-Negotiable)
- Fonts — Arabic: Amiri, Noto Naskh Arabic, Scheherazade New, IBM Plex Sans Arabic, Readex Pro. Latin: Literata, Merriweather, Inter.
- Tashkeel protection: Arabic line-height default 1.95 (range 1.5–2.6); overflow never clips diacritics.
- NO letter-spacing on Arabic. Provide Word Spacing slider instead.
- Paragraph format toggle: Classic Book Indent (`text-indent: 1.5em`, tight gap) vs Modern Block (indent 0, wider spacing).

### 4. Live Customization Panel (real-time, no reload)
- Typography: font family, size 14–36px, line height, word spacing, paragraph spacing, weight 300–600, Subpixel/Antialiased, alignment Start/Justify, indent toggle.
- Layout: max reading width 45ch–85ch, paginated/scroll toggle, single/two-page spread on wide screens.
- Themes: Warm Paper (#FAF8F5 / #24211D), Sepia (#F4ECD8 / #3E3024), Charcoal Dark (#18181B / #D4D4D8), OLED Night (#000000 / #A1A1AA). Custom bg/text pickers with live WCAG contrast ratio.
- Lighting: brightness dimmer (pointer-events:none overlay), warmth/blue-light amber overlay.

### 5. Library & Persistence (Offline-First)
Persist novels, reading positions, bookmarks, highlights and preferences locally — a personal offline shelf. Quick Bookmarks, In-book Search (ignores Tashkeel), Estimated Reading Time Left per chapter and book.

### Guidelines
Ultra-minimal UI focused on reading. Smooth 60fps page transitions with an option to disable animations (e-ink feel). Build parser + pagination hook carefully (avoid off-by-one rounding in RTL scrollLeft), then customization, then library.
