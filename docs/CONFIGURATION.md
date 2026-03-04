# Configuration: prompts, data, and styles

This document is the single place to see how to change prompts, data files, note styles, annotation (chat markup) styles, paper layout, and main chat styling.

---

## 1. Prompts (API only)

**Rule:** Prompt files and annotation rules live in `frontend/api/prompts/`.

| File | Purpose |
|------|--------|
| `prompt.md` | Main agent system prompt |
| `closers.md` | Conversation closing lines |
| `easter_egg_prompt.md` | Easter egg prompt |
| `left_philospher.md` | Left philosopher persona and instructions |
| `right_philospher.md` | Right philosopher persona and instructions |
| `phil_annotations.json` | Rules for notes/annotations (same format as `public/data/phil_annotations.json`); used by the API when deployed so annotations load without `public/data` |

Edit these files to change what the agent and philosophers are told to do. The backend (Express and Azure API) reads from this directory (or from `PROMPTS_DIR` if set).

---

## 2. Data files

**Rule:** Non-prompt data lives under `frontend/public/data/`.

| File | Purpose |
|------|--------|
| `phil_annotations.json` | Rules for notes and annotations: `userText`, `respondText`, `mode` (`note`, `rewrite`, `keyword`, `highlight`, `strike`). Served by `/api/philosopher-notes`. Backend loads from `public/data/phil_annotations.json` or `api/prompts/phil_annotations.json` (or `PHIL_ANNOTATIONS_FILE` if set). |
| `paper-config.json` | Per-paper image: `padding` (top/right/bottom/left in **percent**), `width`, `height` (px), optional `scale`. Keys are paper image paths (e.g. `imgs/paper3.png`). Defines the paper list and layout. Loaded by `noteFormatConfig.js`. |

---

## 3. Annotation config (chat message markup)

**What it controls:** When the user sends a message, matching words are marked up (highlight, strike-through, circle, etc.) using rules from phil_annotations. Left and right each have their own colors and animation. This affects only the **chat** (the user’s message), not the text on the notes.

**Where:** `public/js/annotationConfig.js` (loaded before `annotation.js`).

| Key | Meaning |
|-----|--------|
| `ANNOTATION_DEFAULT_COLOR` | Fallback color (hex or CSS name) when no color array is provided |
| `ANNOTATION_MODE_TO_TYPES` | Map from rule `mode` (`keyword`, `highlight`, `strike`) to array of RoughNotation types (e.g. `keyword` → `["circle", "box", "underline"]`) |
| `ANNOTATION_PHILOSOPHER_SETTINGS` | Per side (`left`, `right`): `animationDuration` (ms), `strokeWidth`, `padding`, `iterations`, `bracketSides`, `keywordColors`, `highlightColors`, `strikeColors` (arrays; one color chosen at random per span) |

**Used by:** `annotation.js` (wrapAnnotationKeywords, applyRoughNotationToKeywordSpans).

---

## 4. Notes config (philosopher notes on paper)

**What it controls:** Note text style (font, color, spacing, opacity, text inset), paper list and per-paper padding/size, and height-estimation heuristics. Also drives philosopher **panel** styling (left/right sidebar) via CSS vars set from `NOTE_FORMAT`.

**Where:** `public/js/noteFormatConfig.js`

| Key | Meaning |
|-----|--------|
| `NOTE_FORMAT` | Per side (`left`, `right`): `lineHeight`, `paddingTop`/`Right`/`Bottom`/`Left` (%), `opacity`, `color`, `fontSize`, `fontFamily`. Keys match CSS vars `--note-*`. |
| `CONTENT_HEIGHT_SCALING` | Multiplier for “how tall” content counts when fitting on a note: `base`, `left`, `right`. Effective = base × (left or right). |
| `ESTIMATE_LINE_HEIGHT_PX` | Estimated px per line for “will it fit?” (per side). |
| `PAPER_CONFIG` | Paper image path → `{ padding: { top, right, bottom, left } %, width, height, scale? }`. Loaded from `data/paper-config.json` on init; in-code object is fallback. |
| `getPaperImages()` | Returns the list of paper URLs (from `PAPER_CONFIG` keys). Used by `notePages.js`. |
| `getPaperPadding(paperUrl)` | Padding in percent for a paper. |
| `getPaperSize(paperUrl)` | Final size in px (width × scale, height × scale). |
| `applyNoteFormatToPanels()` | Sets `--note-*` on `#left-philosopher` and `#right-philosopher` from `NOTE_FORMAT`. Call once at app init. |

**Used by:** `notePages.js`, `note-pages.css`, `left-philosopher.css`, `right-philosopher.css` (via `var(--note-*)`).

---

## 5. Chat config (main chat column)

**What it controls:** Main column background, margins, padding, message bubble colors, labels, status, editor font, cursor look, and divider line. All values are applied as CSS custom properties (`--chat-*`) at runtime.

**Where:** `public/js/chatConfig.js`

| Key (in `CHAT_STYLE`) | Maps to CSS var | Meaning |
|------------------------|-----------------|--------|
| `mainBg`, `mainMargin`, `mainPadding`, `mainMaxWidth`, `mainMinWidthLg`, `mainTextColor`, `mainBorderRadius` | `--chat-bg`, `--chat-margin`, etc. | Main column layout and text color |
| `labelColor`, `userLabelColor` | `--chat-label`, `--chat-user-label` | Message labels |
| `userBubbleBg`, `userBubbleBorder`, `assistantBubbleBg`, `assistantBubbleBorder` | `--chat-user-bubble-bg`, etc. | Message bubbles |
| `statusColor`, `statusErrorColor` | `--chat-status`, `--chat-status-error` | Status text |
| `editorFontFamily`, `editorLineHeight`, `placeholderColor` | `--chat-editor-font`, etc. | Editor and placeholder |
| `cursorBg`, `cursorBorder`, `cursorShadow`, `cursorMinWidth`, `cursorMinHeight` | `--chat-cursor-*` | Cursor appearance |
| `lineMargin`, `lineHeight`, `lineColor`, `lineTransition` | `--chat-line-*` | Divider line |

**Apply:** Call `ChatConfig.applyChatStyle()` once at app init (e.g. in `app.js`).

**Used by:** `chat-paper.css` (all values via `var(--chat-*, fallback)`).

---

## Quick reference: “I want to change…”

| Goal | File | What to edit |
|------|------|--------------|
| Note text color, font, size, line spacing, opacity, text inset | `js/noteFormatConfig.js` | `NOTE_FORMAT.left` / `.right` |
| Estimated line height for “will it fit?” | `js/noteFormatConfig.js` | `ESTIMATE_LINE_HEIGHT_PX.left` / `.right` |
| How “tall” content counts for fitting | `js/noteFormatConfig.js` | `CONTENT_HEIGHT_SCALING` → `base`, `left`, `right` |
| Paper list, edge padding, size or scale per sheet | `data/paper-config.json` or `js/noteFormatConfig.js` → `PAPER_CONFIG` | Per-key: `padding` (top/right/bottom/left %), `width`, `height`, `scale` |
| Rules for notes and annotations (what triggers notes/rewrite/keyword/highlight/strike) | `data/phil_annotations.json` | Array of `{ userText, respondText, mode }` |
| Chat markup colors / duration / stroke per philosopher | `js/annotationConfig.js` | `ANNOTATION_PHILOSOPHER_SETTINGS.left` / `.right` |
| Chat markup mode → RoughNotation type | `js/annotationConfig.js` | `ANNOTATION_MODE_TO_TYPES` |
| Main chat column colors, margins, editor, cursor, divider | `js/chatConfig.js` | `CHAT_STYLE` (then call `applyChatStyle()`) |
| Agent or philosopher instructions | `api/prompts/*.md` | Edit the corresponding `.md` file |

---

## File roles (summary)

| File | Role |
|------|------|
| `api/prompts/*.md` | Prompts only; no data |
| `data/phil_annotations.json` | Rules for notes + annotations; served by API |
| `data/paper-config.json` | Paper list, padding (%), size (px), scale per image |
| `js/annotationConfig.js` | Annotation fallback color, mode→types, per-philosopher settings |
| `js/noteFormatConfig.js` | Note format, paper config loading, estimation constants, `applyNoteFormatToPanels()` |
| `js/chatConfig.js` | Chat column style object and `applyChatStyle()` |
| `js/annotation.js` | Uses AnnotationConfig; wraps keywords and applies RoughNotation |
| `js/notePages.js` | Uses NoteFormatConfig (paper list, padding, size, note format); creates notes and applies `--note-*` to content |
| `css/note-pages.css` | Uses `--note-*` for `.note-page__content` |
| `css/left-philosopher.css`, `css/right-philosopher.css` | Use `var(--note-*)` for panel note content (set from NOTE_FORMAT) |
| `css/chat-paper.css` | Uses `var(--chat-*)` for main chat column (set from ChatConfig) |
