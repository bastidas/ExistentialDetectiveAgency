# Configuration: prompts, data, and styles

This document is the single place to see how to change prompts, data files, note styles, annotation (chat markup) styles, paper layout, and main chat styling.

---

## Environment (DEV, OFFLINE, DEBUG_LOGS)

Backend and API behavior are controlled by optional env vars. See `frontend/.env.example` for the full list.

| Env var | Purpose |
|--------|---------|
| `DEV=1` | Enables dev-only UI and advanced tools (philosopher panels, note debug boxes, etc.). Does **not** disable the AI or skip the API key. |
| `OFFLINE=1` | Disables LLM calls: no API key required, chat and philosopher-dialog return dummy responses. |
| `DEBUG_LOGS=1` | Verbose logging: enables `/api/debug`, server startup logs, per-request logs (e.g. full message sent to the LLM), and debug info in chat responses. |

These are independent: e.g. `DEV=1` with real LLM shows dev UI; `OFFLINE=1` without `DEV` returns dummies with normal UI.

### Durable user state (Azure Table Storage)

Full layout, partition keys, and `/api/chat-state` fields are documented in **[`docs/durable-user-state.md`](durable-user-state.md)**.

| Env var | Purpose |
|--------|---------|
| `MAX_THREAD_EVENTS` | Cap on stored chat thread events per session (default `400`). |
| `MAX_THREAD_JSON_CHARS` | Max serialized size of thread JSON per row (default `800000`). |
| `N_DOSSIER_UPDATE_TURNS` | Run dossier analyzer every N detective turns (default `12`; see `summarization.js`). |

---

## 1. Prompts (API only)

**Rule:** Prompt files and annotation rules live in `frontend/api/prompts/`.

### Current prompt folder layout

- `frontend/api/prompts/detective/`
  - `detective_persona.md`
  - `detective_instructions.md`
  - `detective_turn.schema.json`
  - `detective_opening_lines.md`
- `frontend/api/prompts/lumen/`
  - `lumen_persona.md`
  - `lumen_instructions.md`
  - `lumen_philosopher_turn.schema.json`
- `frontend/api/prompts/umbra/`
  - `umbra_persona.md`
  - `umbra_instructions.md`
  - `umbra_philosopher_turn.schema.json`
- `frontend/api/prompts/attache/` (attaché baseline orchestration prompts)

Path wiring for these prompt files is configured in `frontend/api/src/config.js`.

| File | Purpose |
|------|--------|
| `prompt.md` | Main agent system prompt |
| `closers.md` | Conversation closing lines |
| `easter_egg_prompt.md` | Easter egg prompt |
| `left_philosopher_user_res.md` | Left philosopher persona and instructions when addressing the user (produces `left_philosopher_user_response` and `left_philosopher_notes`) |
| `left_philosopher_other_res.md` | Left philosopher persona and instructions when responding to the right philosopher (produces `left_philosopher_other_response`) |
| `right_philosopher_user_res.md` | Right philosopher persona and instructions when addressing the user (produces `right_philosopher_user_response` and `right_philosopher_notes`) |
| `right_philosopher_other_res.md` | Right philosopher persona and instructions when responding to the left philosopher (produces `right_philosopher_other_response`) |
| `phil_annotations.json` | Rules for notes/annotations (same format as `public/data/phil_annotations.json`); used by the API when deployed so annotations load without `public/data` |

Edit these files to change what the agent and philosophers are told to do. The backend (Express and Azure API) reads from this directory (or from `PROMPTS_DIR` if set).

---

## 1b. Philosopher–philosopher dialog (when needed)

**What it is:** After each main chat response, the frontend may send an optional second request (`POST /api/philosopher-dialog`) so the left and right philosophers can respond to each other’s notes. This request uses a different context (user+detective conversation plus all philosopher outputs so far) and a focused task: **other_response only** (no user-facing response, no callouts).

**When it runs:** “When needed” is controlled by **two separate probabilities**, one for each side. Each time the main chat returns, the frontend waits a short delay then rolls the dice: should the left philosopher respond to the right? Should the right respond to the left? Left and right have different rates so you can make one side chattier than the other.

**Where to change the probabilities:**

| Variable | File | Meaning |
|----------|------|---------|
| `LEFT_PHILOSOPHER_INTERACTION_RATE` | `frontend/public/js/chatSend.js` | Probability (0–1) that the left philosopher will respond to the right in the follow-up dialog. Default 0.4. |
| `RIGHT_PHILOSOPHER_INTERACTION_RATE` | `frontend/public/js/chatSend.js` | Probability (0–1) that the right philosopher will respond to the left in the follow-up dialog. Default 0.6. |

Adjust these to make philosopher–philosopher exchanges more or less frequent, or to bias one side.

### Inter-dialog labels ("To Umbra" / "To Lumen")

The prefix shown before philosopher-to-philosopher lines (`otherResponse`) is configured in:

- `frontend/public/js/philosopherDisplay.config.js` via `OTHER_RESPONSE_PREFIX`

Current defaults:

- Left philosopher (Lumen): `[To Umbra] `
- Right philosopher (Umbra): `[To Lumen] `

---

## 2. Data files

**Rule:** Non-prompt data lives under `frontend/public/data/`.

| File | Purpose |
|------|--------|
| `phil_annotations.json` | Rules for notes and annotations: `userText`, `respondText`, `mode` (`note`, `rewrite`, `keyword`, `highlight`, `strike`). Served by `/api/philosopher-notes`. Backend loads from `public/data/phil_annotations.json` or `api/prompts/phil_annotations.json` (or `PHIL_ANNOTATIONS_FILE` if set). |
| `paper-config.json` | Per-paper image: `padding` (top/right/bottom/left in **percent**), `width`/`height` (legacy px values interpreted as relative multipliers), optional `scale`. Keys are paper image paths (e.g. `imgs/paper3.png`). Loaded by `noteFormatConfig.js`. |

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
| `PAPER_CONFIG` | Paper image path → `{ padding %, widthFactor, heightFactor, scale }`. Factors come from the legacy px values in `data/paper-config.json`, so relative differences stay intact while the base canvas + responsive scaling control real pixels. |
| `getPaperImages()` | Returns the list of paper URLs (from `PAPER_CONFIG` keys). Used by `notePages.js`. |
| `getPaperPadding(paperUrl)` | Padding in percent for a paper. |
| `getPaperSize(paperUrl)` | Final size in px (`NOTE_BASE_SIZE` × factor × scale × responsive note scale). |
| `applyNoteFormatToPanels()` | Sets `--note-*` on `#left-philosopher` and `#right-philosopher` from `NOTE_FORMAT`. Call once at app init. |

**Viewport-responsive note scaling and breakpoints:**

- Core width bands and names (e.g. `mobile-xs`, `mobile-sm`, `mobile`, `medium`, `desktop-base`, `desktop-wide`) are defined once in `public/js/breakpointsConfig.js` on `window.EDABreakpoints`.
- `noteFormatConfig.js` reads `EDABreakpoints.RESPONSIVE_STEPS`, `RESPONSIVE_WIDE`, and `RESPONSIVE_BASE` to decide how note and font scaling change with `window.innerWidth`.
- `viewportNotes.js` uses `EDABreakpoints.LAYOUT` to set `data-viewport="mobile" | "medium" | "large"` and also exposes the fine-grained band as `data-width-band` on `<body>`.
- CSS media queries still use plain pixel values (e.g. `max-width: 768px`, `max-width: 1440px`), but these should conceptually match the ranges in `breakpointsConfig.js`.

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

## 6. Typing config (detective / attaché replies)

**What it controls (frontend):** How the detective's and attaché's chat replies are "typed" on screen when the full text is already known on the client: speed (characters per step), delay between steps, whether very long replies animate, and whether to respect users' reduced-motion preferences.

**Where:** `public/js/shared.typingConfig.js`

| Key (in `TYPING_CONFIG`) | Meaning |
|---------------------------|---------|
| `assistantCharsPerTick` | Number of characters revealed per animation step for assistant (detective / attaché) replies that use `EDAUtils.animateAssistantText`. Higher = faster visible typing. |
| `assistantTickMs` | Base delay between animation steps in milliseconds. Lower = faster typing cadence. |
| `assistantTickVariationMs` | Random jitter (in ms) added on top of `assistantTickMs` for each step. Higher = more uneven / "human" timing. Set to `0` for perfectly regular steps. |
| `assistantMaxChars` | Maximum reply length (in characters) to animate. If a reply is longer than this, it is rendered instantly instead of typed out. Set to `0` to always animate the full reply. |
| `respectReducedMotion` | When `true`, skips the typing animation for users who have `prefers-reduced-motion: reduce` enabled, and shows the full reply instantly. |

**Used by:** `public/js/shared.utils.js` → `EDAUtils.animateAssistantText`, which is called from `public/js/chat.messageUI.js`, `public/js/chat.send.js`, and `public/js/chat.route.js` when rendering non-streaming assistant (detective / attaché) messages.

**Important:** Streaming replies from `/api/chat-stream` do **not** use this config for timing. Their speed is controlled by backend-only knobs described next.

### 6b. Streaming speed (backend-only)

**What it controls (backend):** How quickly already-computed replies are dribbled out over `/api/chat-stream` as NDJSON `delta` events. This affects how "live" streaming feels for both the detective and the attaché when the frontend uses the streaming path (see `chat.send.js`).

**Where:** `frontend/api/src/config.js` and `frontend/api/src/chatService.js`

| Key (in backend config) | Meaning |
|-------------------------|---------|
| `STREAM_CHUNK_SIZE` | Number of characters included in each streamed `delta` event. Higher = fewer, larger chunks. |
| `STREAM_DELAY_MS` | Delay (in milliseconds) between `delta` events when emitting a single reply. Lower = faster stream; `0` streams all chunks back-to-back. |

**Defaults:** If unset, the backend falls back to `STREAM_CHUNK_SIZE = 12`, `STREAM_DELAY_MS = 30`.

**Env overrides:** You can override these without code changes using:

```bash
STREAM_CHUNK_SIZE=48
STREAM_DELAY_MS=5
```

**Used by:** `frontend/api/src/chatService.js` → `handleChatStream()`, which reuses `handleChatRequest()` to get the full reply and then slices it into small "delta" chunks before sending a final event.

---

## Quick reference: “I want to change…”

| Goal | File | What to edit |
|------|------|--------------|
| Note text color, font, size, line spacing, opacity, text inset | `js/noteFormatConfig.js` | `NOTE_FORMAT.left` / `.right` |
| Estimated line height for “will it fit?” | `js/noteFormatConfig.js` | `ESTIMATE_LINE_HEIGHT_PX.left` / `.right` |
| How “tall” content counts for fitting | `js/noteFormatConfig.js` | `CONTENT_HEIGHT_SCALING` → `base`, `left`, `right` |
| Paper list, edge padding, relative size or scale per sheet | `data/paper-config.json` or `js/noteFormatConfig.js` → `PAPER_CONFIG` | Per-key: `padding` (top/right/bottom/left %), `width`/`height` (treated as relative multipliers), `scale` |
| Rules for notes and annotations (what triggers notes/rewrite/keyword/highlight/strike) | `data/phil_annotations.json` | Array of `{ userText, respondText, mode }` |
| Chat markup colors / duration / stroke per philosopher | `js/annotationConfig.js` | `ANNOTATION_PHILOSOPHER_SETTINGS.left` / `.right` |
| Chat markup mode → RoughNotation type | `js/annotationConfig.js` | `ANNOTATION_MODE_TO_TYPES` |
| Main chat column colors, margins, editor, cursor, divider | `js/chatConfig.js` | `CHAT_STYLE` (then call `applyChatStyle()`) |
| Detective / attaché typing speed and behavior (non-streaming replies) | `public/js/shared.typingConfig.js` | `TYPING_CONFIG.assistantCharsPerTick`, `.assistantTickMs`, `.assistantTickVariationMs`, `.assistantMaxChars`, `.respectReducedMotion` |
| How often left/right philosophers respond to each other | `js/chatSend.js` | `LEFT_PHILOSOPHER_INTERACTION_RATE`, `RIGHT_PHILOSOPHER_INTERACTION_RATE` (0–1) |
| Agent or philosopher instructions | `api/prompts/*.md` | Edit the corresponding `.md` file |

---

## File roles (summary)

| File | Role |
|------|------|
| `api/prompts/*.md` | Prompts only; no data |
| `data/phil_annotations.json` | Rules for notes + annotations; served by API |
| `data/paper-config.json` | Paper list, padding (%), relative size hints (`width`/`height`), scale per image |
| `js/annotationConfig.js` | Annotation fallback color, mode→types, per-philosopher settings |
| `js/noteFormatConfig.js` | Note format, paper config loading, estimation constants, `applyNoteFormatToPanels()` |
| `js/chatConfig.js` | Chat column style object and `applyChatStyle()` |
| `js/typingConfig.js` | Typing behavior for detective chat replies (used by `EDAUtils.animateAssistantText()`) |
| `js/annotation.js` | Uses AnnotationConfig; wraps keywords and applies RoughNotation |
| `js/notePages.js` | Uses NoteFormatConfig (paper list, padding, size, note format); creates notes and applies `--note-*` to content |
| `css/note-pages.css` | Uses `--note-*` for `.note-page__content` |
| `css/left-philosopher.css`, `css/right-philosopher.css` | Use `var(--note-*)` for panel note content (set from NOTE_FORMAT) |
| `css/chat-paper.css` | Uses `var(--chat-*)` for main chat column (set from ChatConfig) |
