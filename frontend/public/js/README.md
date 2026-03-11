# Frontend scripts (`public/js`)

Scripts are loaded with classic `<script>` tags in a **fixed order**. Do not reorder or add scripts without updating this file and the script block in `index.html` (and `notedebug.html` if applicable).

## Naming convention

- **Domain prefix** (dotted filename): `notes.*`, `chat.*`, `annotation.*`, `viewport.*`, `shared.*`, plus `router.js` and `poem.js`.
- **Config files**: `*.config.js` or `*.formatConfig.js` — configuration only (no DOM, minimal logic).
- **Public globals**: All app globals use the `EDA` prefix and PascalCase (e.g. `EDANoteFormatConfig`, `EDANotePages`, `EDAUtils`).

## Load order

Load scripts in this order. Dependencies assume earlier scripts have already run.

1. **Shared / config**
   - `shared.utils.js`
   - `shared.typingConfig.js`
   - `viewport.breakpointsConfig.js`

2. **Notes (config → layout → element → capacity → pages → margin items → queue)**
   - `notes.formatConfig.js`
   - `notes.layout.js`
   - `notes.element.js`
   - `notes.capacity.js`
   - `chat.config.js`
   - `notes.handwriter.js`
   - `notes.pages.js`
   - `notes.randomMarginItems.js`
   - `notes.queueManager.js`

3. **Philosopher rules** (depends on note queue and note pages)
   - `notes.philosopherRules.js`

4. **Annotation**
   - `philosopherDisplay.config.js` (fonts, 4-color set, line breaks; annotation.config derives colors from it)
   - `annotation.config.js`
   - `annotation.markup.js`

5. **Chat UI and send**
   - `chat.messageUI.js`
   - `chat.closingStamps.js`
   - `chat.input.js`
   - `chat.send.js`
   - `viewport.notes.js`

6. **App bootstrap**
   - `app.js` (in `public/`)

7. **Route-specific**
   - `chat.route.js`
   - `poem.js`
   - `router.js`

External: `rough-notation.iife.js` (unpkg) is loaded before annotation scripts.

## Adding or removing scripts

1. Add/remove the `<script src="js/...">` tag in `index.html` in the correct position above.
2. If the script is used on the note-debug page, update `notedebug.html` as well.
3. Update this README so the load order stays accurate.
