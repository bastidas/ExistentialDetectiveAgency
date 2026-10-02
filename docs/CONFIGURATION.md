# Configuration: prompts, data, and styles

How to change prompts, data files, note styles, annotation (chat markup) styles, paper layout, and main chat styling.

Related:

- Concept, philosophy, and where state belongs: [`concept.md`](concept.md)
- Prompt assembly (composer, catalogs, turn tails): [`agent-prompt-construction.md`](agent-prompt-construction.md)
- Durable storage schema and `/api/chat-state`: [`durable-user-state.md`](durable-user-state.md)
- Env var list: [`.env.example`](../.env.example)

---

## Environment

Backend and API behavior are controlled by optional env vars. See `.env.example` for the full list.

| Env var | Purpose |
|--------|---------|
| `DEV=1` | Enables dev-only UI and lab tools (philosopher panels, note debug boxes, etc.). Does **not** disable the AI or skip the API key. |
| `OFFLINE=1` | Disables LLM calls: no API key required; agents return dummy responses. |
| `DEBUG_LOGS=1` | Verbose logging: enables `/api/debug`, server startup logs, per-request logs, and debug info in chat responses. |
| `DOSSIER_REFRESH_EVERY_N_DETECTIVE_TURNS` | Run the dossier analyzer every N completed detective exchanges (default `3`). |

These are independent: e.g. `DEV=1` with a real LLM shows the dev UI; `OFFLINE=1` without `DEV` returns dummies with the normal UI.

Table storage, thread caps, and time-away bins are documented in [`durable-user-state.md`](durable-user-state.md). Common ones: `AZURE_STORAGE_CONNECTION_STRING`, `DOSSIER_TABLE_NAME`, `DURABLE_STORAGE_MODE`, `MAX_THREAD_EVENTS`, `MAX_THREAD_JSON_CHARS`.

---

## 1. Prompts (API only)

**Rule:** Model-facing markdown and JSON live in `api/prompts/`. Composer/registry code lives in `api/prompting/` — do not mix them.

Path wiring is in `api/config.js` (override the folder with `PROMPTS_DIR` if needed). Each agent is composed as: persona + instructions + optional catalog turn block + response-format appendix. See [`agent-prompt-construction.md`](agent-prompt-construction.md).

### Folder layout

- `api/prompts/detective/` — `detective_persona.md`, `detective_instructions.md`, `detective_turn.schema.json`, `detective_opening_lines.md`, `prompt_catalog.json` (return / closure / therapy / scene copy)
- `api/prompts/attache/` — `attache_persona.md`, `attache_instructions.md`, `attache_turn.schema.json`, `attache_opening_lines.md`, `attache_final_lines.md`, `attache_questions.json`, `attache_phase_transition_instructions.json`, `prompt_catalog.json`
- `api/prompts/lumen/` — `lumen_persona.md`, `lumen_instructions.md`, `lumen_philosopher_turn.schema.json`, `prompt_catalog.json`
- `api/prompts/umbra/` — same pattern as lumen
- `api/prompts/backend_phil_annotations.json` — API copy of annotation rules (or `PHIL_ANNOTATIONS_FILE`)

Edit the matching `.md` / catalog JSON to change what an agent is told. `*_prompts.md` files are mock placeholders used by the registry, not the live detective/attaché system prompt.

### Philosophers on the same chat turn

Lumen and Umbra run **in parallel with the detective** on `POST /api/chat`. There is no separate follow-up request.

`POST /api/philosopher-dialog` still exists as a stub and returns **410 Gone**.

The prefix shown before philosopher-to-philosopher lines (`otherResponse`) is `OTHER_RESPONSE_PREFIX` in `web/js/philosophers/displayConfig.js`:

- Left (Lumen): `[To Umbra] `
- Right (Umbra): `[To Lumen] `

---

## 2. Data files

**Rule:** Non-prompt data lives under `web/data/`. Images live under `web/assets/imgs/` (see [Images](#2b-images)).

| File | Purpose |
|------|--------|
| `phil_annotations.json` | Rules for notes and annotations: `userText`, `respondText`, `mode` (`note`, `rewrite`, `keyword`, `highlight`, `strike`). Loaded by the site from `web/data/phil_annotations.json`. The API uses `api/prompts/backend_phil_annotations.json` (or `PHIL_ANNOTATIONS_FILE`). |
| `paper-config.json` | Per-paper layout: `text-padding` (%), `scale`, `bounding_x_frac` / `bounding_y_frac`, `type` (`small` / `medium` / `full`). Keys are **filenames** such as `paper3.webp`, resolved to `web/assets/imgs/paper/paper3.webp`. Loaded by `web/js/notes/formatConfig.js`. |
| `paper-configB.json` | Same shape as `paper-config.json`. Not loaded by the app; a scratch copy. |
| `object-config.json` | Random margin objects. Keys are filenames. Default folder is `web/assets/imgs/misc_objects/`. Baseline cards set `"base_path": "assets/imgs/baseline/"`. Loaded by `web/js/notes/randomMarginItems.js`. |
| `poems.json` | Poem list. Keys are markdown files in the same folder (`poem1.md`, `poem2.md`), not images. |
| `closing_stamps.json` | Rubber-stamp phrases and colors. No image paths. |

---

## 2b. Images

There is no conversion step. The browser loads whatever path the HTML, CSS, or JSON points at. **WebP** is the convention for papers, desk objects, and landing photos. **PNG** is used for a tiled texture and folder art (transparency). **JPG** files under `cityscapes/` and `other/` are not referenced by the JSON configs.

| Folder | Used by | How the path is built |
|--------|---------|------------------------|
| `web/assets/imgs/paper/` | Philosopher note sheets | Config key `paper3.webp` → `assets/imgs/paper/paper3.webp` |
| `web/assets/imgs/misc_objects/` | Random margin objects | Config key with no `base_path` → `assets/imgs/misc_objects/` + key |
| `web/assets/imgs/baseline/` | Attaché Voight-Kampff cards | `object-config.json` entries with `"base_path": "assets/imgs/baseline/"` |
| `web/assets/imgs/other/` | Landing, favicon, leather background, lab folder graphics | Hard-coded in `web/index.html`, `web/styles/style.css`, `web/lab/folder-menu-dev.html` |
| `web/assets/imgs/cityscapes/` | (none yet) | Not listed in `web/data/` |

Adding a paper or object: put a `.webp` (or PNG if you need alpha) in the matching folder, then add a JSON entry whose **key is the exact filename**. Changing the extension without updating the key will 404. Extra files on disk that are not in JSON are unused.

---

## 3. Annotation config (chat message markup)

**What it controls:** When the user sends a message, matching words are marked up (highlight, strike-through, circle, etc.) using rules from `phil_annotations`. Left and right each have their own colors and animation. This affects only the **chat** (the user's message), not the text on the notes.

**Where:** `web/js/philosophers/config.js` (loaded before `web/js/philosophers/markup.js`). Colors are derived from the 4-color set in `web/js/philosophers/displayConfig.js` when that script is loaded.

| Key | Meaning |
|-----|--------|
| `ANNOTATION_DEFAULT_COLOR` | Fallback color (hex or CSS name) when no color array is provided |
| `ANNOTATION_MODE_TO_TYPES` | Map from rule `mode` (`keyword`, `highlight`, `strike`) to an array of RoughNotation types (e.g. `keyword` → `["circle", "box", "underline"]`) |
| `ANNOTATION_PHILOSOPHER_SETTINGS` | Per side (`left`, `right`): `animationDuration` (ms), `strokeWidth`, `padding`, `iterations`, `bracketSides`, `keywordColors`, `highlightColors`, `strikeColors` (arrays; one color chosen at random per span) |

**Used by:** `web/js/philosophers/markup.js` (`wrapAnnotationKeywords`, `applyRoughNotationToKeywordSpans`).

---

## 4. Notes config (philosopher notes on paper)

**What it controls:** Note layout (line height, padding, paper list, size, height-estimation heuristics). Philosopher **font, color, weight, and opacity** come from `web/js/philosophers/displayConfig.js` and are merged in `getNoteFormat()`. Panel CSS vars (`--note-*`) are set from that merged format.

**Where:** `web/js/notes/formatConfig.js` (`EDANoteFormatConfig`)

| Key | Meaning |
|-----|--------|
| `NOTE_FORMAT` | Per side (`left`, `right`): `lineHeight`, `paddingTop`/`Right`/`Bottom`/`Left` (%). |
| `CONTENT_HEIGHT_SCALING` | Multiplier for how tall content counts when fitting on a note: `base`, `left`, `right`. Effective = base × (left or right). |
| `PAPER_CONFIG` | Filename key (e.g. `paper3.webp`) → `{ textPadding %, scale, bounding fractions, type }`, loaded from `web/data/paper-config.json`. `NOTE_BASE_SIZE` + scale + responsive scale control pixels. |
| `getPaperImages()` | Returns the list of paper URLs (from `PAPER_CONFIG` keys). Used by `web/js/notes/pages.js`. |
| `getPaperPadding(paperUrl)` | Padding in percent for a paper. |
| `getPaperSize(paperUrl)` | Final size in px (`NOTE_BASE_SIZE` × factor × scale × responsive note scale). |
| `applyNoteFormatToPanels()` | Sets `--note-*` on `#left-philosopher` and `#right-philosopher`. Called from `web/app.js` at init. |

**Viewport-responsive note scaling:**

- Width bands (`mobile-xs`, `mobile-sm`, `mobile`, `medium`, `desktop-base`, `desktop-wide`) live in `web/js/shared/viewportBreakpoints.js` on `window.EDABreakpoints`.
- `formatConfig.js` reads `EDABreakpoints.RESPONSIVE_BANDS` for note and font scale vs `window.innerWidth`.
- `web/js/notes/viewport.js` uses `EDABreakpoints.LAYOUT` to set `data-viewport="mobile" \| "medium" \| "large"` and `data-width-band` on `<body>`.
- CSS media queries still use plain pixel values (e.g. `max-width: 768px`, `max-width: 1440px`); keep them aligned with `EDABreakpoints`.

**Used by:** `web/js/notes/pages.js`, `web/styles/note-pages.css`, `web/styles/left-philosopher.css`, `web/styles/right-philosopher.css` (via `var(--note-*)`).

---

## 5. Chat config (main chat column)

**What it controls:** Main column background, margins, padding, message bubble colors, labels, status, editor font, cursor look, and divider line. Values are applied as CSS custom properties (`--chat-*`) at runtime.

**Where:** `web/js/chat/config.js` (`EDAChatConfig`)

| Key (in `CHAT_STYLE`) | Maps to CSS var | Meaning |
|------------------------|-----------------|--------|
| `mainBg`, `mainMargin`, `mainPadding`, `mainMaxWidth`, `mainMinWidthLg`, `mainTextColor`, `mainBorderRadius` | `--chat-bg`, `--chat-margin`, etc. | Main column layout and text color |
| `labelColor`, `userLabelColor` | `--chat-label`, `--chat-user-label` | Message labels |
| `userBubbleBg`, `userBubbleBorder`, `assistantBubbleBg`, `assistantBubbleBorder` | `--chat-user-bubble-bg`, etc. | Message bubbles |
| `statusColor`, `statusErrorColor` | `--chat-status`, `--chat-status-error` | Status text |
| `editorFontFamily`, `editorLineHeight`, `placeholderColor` | `--chat-editor-font`, etc. | Editor and placeholder |
| `cursorBg`, `cursorBorder`, `cursorShadow`, `cursorMinWidth`, `cursorMinHeight` | `--chat-cursor-*` | Cursor appearance |
| `lineMargin`, `lineHeight`, `lineColor`, `lineTransition` | `--chat-line-*` | Divider line |

**Apply:** `EDAChatConfig.applyChatStyle()` once at app init (`web/app.js`).

**Used by:** `web/styles/chat-paper.css` (via `var(--chat-*, fallback)`).

---

## 6. Typing config (detective / attaché replies)

**What it controls:** How already-known assistant replies are “typed” into the DOM: characters per step, delay, jitter, max length to animate, and reduced-motion.

**Where:** `web/js/shared/typingConfig.js` (`EDAUtils.TYPING_CONFIG`)

| Key | Meaning |
|-----|---------|
| `assistantCharsPerTick` | Characters revealed per animation step. Higher = faster. |
| `assistantTickMs` | Base delay between steps (ms). Lower = faster. |
| `assistantTickVariationMs` | Random jitter added to `assistantTickMs`. `0` = regular steps. |
| `assistantMaxChars` | If a reply is longer than this, it is shown instantly. `0` = always animate. |
| `respectReducedMotion` | When `true`, skip animation if `prefers-reduced-motion: reduce`. |

In `DEV` mode the client forces a near-instant reveal (via `body[data-dev-mode]` or `GET /api/config`).

**Used by:** `EDAUtils.animateAssistantText` in `web/js/shared/utils.js`, called from `web/js/chat/messageUI.js`, `web/js/chat/send.js`, and `web/js/chat/route.js`.

Local Express also exposes `POST /api/chat-stream` (the chat UI prefers it). That handler currently sends a single final event after `handleChatRequest` — there are no `STREAM_CHUNK_SIZE` / `STREAM_DELAY_MS` knobs. Azure Functions (`api/index.js`) serves `POST /api/chat`, not chat-stream.

---

## Quick reference: “I want to change…”

| Goal | File | What to edit |
|------|------|--------------|
| Note layout (line height, padding) | `web/js/notes/formatConfig.js` | `NOTE_FORMAT.left` / `.right` |
| Note / philosopher font, color, size, opacity | `web/js/philosophers/displayConfig.js` | `PHILOSOPHER_BASE_STYLE`, `PHILOSOPHER_FONTS`, `PHILOSOPHER_COLORS` |
| How “tall” content counts for fitting | `web/js/notes/formatConfig.js` | `CONTENT_HEIGHT_SCALING` → `base`, `left`, `right` |
| Paper list, edge padding, scale per sheet | `web/data/paper-config.json` | Per-key filename (`paper3.webp`): `text-padding` (%), `scale`, `type`. Image must exist at `web/assets/imgs/paper/` |
| Margin objects (magnifier, baseline cards, etc.) | `web/data/object-config.json` | Per-key filename; optional `base_path` for `assets/imgs/baseline/` |
| Rules for notes and annotations | `web/data/phil_annotations.json` | Array of `{ userText, respondText, mode }` |
| Chat markup colors / duration / stroke per philosopher | `web/js/philosophers/config.js` | `ANNOTATION_PHILOSOPHER_SETTINGS.left` / `.right` |
| Chat markup mode → RoughNotation type | `web/js/philosophers/config.js` | `ANNOTATION_MODE_TO_TYPES` |
| “To Umbra” / “To Lumen” prefixes | `web/js/philosophers/displayConfig.js` | `OTHER_RESPONSE_PREFIX` |
| Main chat column colors, margins, editor, cursor, divider | `web/js/chat/config.js` | `CHAT_STYLE` (then `applyChatStyle()`) |
| Detective / attaché typing speed | `web/js/shared/typingConfig.js` | `TYPING_CONFIG` |
| Agent or philosopher instructions | `api/prompts/**/*.md` and `prompt_catalog.json` | Matching persona, instructions, or catalog entry |

---

## File roles (summary)

| File | Role |
|------|------|
| `api/prompts/**/*.md` | Prompts only; no site data |
| `api/prompts/*/prompt_catalog.json` | Per-turn instruction bodies (detective / attaché) |
| `web/data/phil_annotations.json` | Rules for notes + annotations (site); API copy is `api/prompts/backend_phil_annotations.json` |
| `web/data/paper-config.json` | Paper list and layout; keys map to `web/assets/imgs/paper/` |
| `web/data/object-config.json` | Margin objects; keys map to `web/assets/imgs/misc_objects/` or `base_path` |
| `web/js/philosophers/displayConfig.js` | Fonts, 4-color set, other-response prefixes; source for note text style |
| `web/js/philosophers/config.js` | Annotation fallback color, mode→types, per-philosopher settings |
| `web/js/philosophers/markup.js` | Uses `EDAAnnotationConfig`; wraps keywords and applies RoughNotation |
| `web/js/notes/formatConfig.js` | Note layout, paper config loading, estimation, `applyNoteFormatToPanels()` |
| `web/js/notes/pages.js` | Uses `EDANoteFormatConfig`; creates notes and applies `--note-*` to content |
| `web/js/chat/config.js` | Chat column style and `EDAChatConfig.applyChatStyle()` |
| `web/js/shared/typingConfig.js` | Typing behavior for assistant replies (`EDAUtils.animateAssistantText`) |
| `web/styles/note-pages.css` | Uses `--note-*` for `.note-page__content` |
| `web/styles/left-philosopher.css`, `web/styles/right-philosopher.css` | Use `var(--note-*)` for panel note content |
| `web/styles/chat-paper.css` | Uses `var(--chat-*)` for the main chat column |
