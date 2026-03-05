# Merge Inventory – Step 1 (March 4, 2026)

## frontend/public (chat)

**Fonts & global styles**
- Google Fonts: Cutive Mono (loaded via `<link>` in index.html).
- Local stack: system-ui, -apple-system, monospace defined in style.css and css/theme.css.
- Active CSS files: style.css, css/left-philosopher.css, css/right-philosopher.css, css/note-pages.css, css/chat-paper.css, css/landing.css (unused today), css/note-pages.css, css/theme.css.

**Scripts & runtime deps**
- Local modules loaded in order: js/utils.js, js/noteFormatConfig.js, js/noteCapacity.js, js/chatConfig.js, js/handwriter.js, js/notePages.js, js/noteQueueManager.js, js/philosopherRules.js, js/annotationConfig.js, js/annotation.js, js/messageUI.js, js/chatInput.js, js/chatSend.js, app.js.
- External script: https://unpkg.com/rough-notation@0.5.1/lib/rough-notation.iife.js.
- API touchpoints: `app.js` fetches `/api/debug`; chat send modules hit `/api/chat` (not in this doc but implied by EDAChatSend).

**Assets & data**
- Images already under frontend/public/imgs (eye icons, paper textures, etc.).
- Shared assets live in frontend/public/assets with subfolders: imgs/ (glass.png, letters.png, measure.png, cityscapes photography set, cat portraits, pages), vids/ (waning_2160p30.mp4, waxing_2160p30.mp4).
- Data files consumed by chat: data/paper-config.json, data/phil_annotations.json, data/poem.md (currently unused by chat but already present).

## yang/ (intro + poem)

**Build surface**
- Vite + React entrypoint (`yang/index.html` ➜ `/src/main.tsx` ➜ `App.tsx`).
- Global styles imported via `/css/theme.css` and `/src/App.css`.

**Assets & fonts**
- Fonts: Courier New (primary) + Segoe/system stack defined in public/css/theme.css.
- Images referenced in App.css/App.tsx: `/imgs/glass.png`, `/imgs/measure.png`, `/imgs/letters.png`, `/imgs/black_cat_left_gaze.png`, `/imgs/black_cat_right_gaze.png`, `/imgs/pale_cale_up_right_gaze.png`, `/imgs/page17.png`-`page20.png`, `/imgs/Apollo_17_Moon_Panorama.jpg`, `/imgs/letters.png`.
- Background video: `/vids/waning_2160p30.mp4` (waxing clip unused but available).
- Content data: `/poem.md` (same text as frontend/public/data/poem.md but served from yang/public/poem.md today).

**React-only behaviors to port**
- Splash ➜ landing ➜ poem routing handled via `showSplash` and `showPoemExperience` in App.tsx.
- Background video element (`video.background-video` + overlay) mounted at top-level; always loops/mutes.
- Poem autoscroll engine:
  - Loads `/poem.md`, splits into sentences, drives `currentIndex`.
  - Maintains animation phases (`intro`, `hold`, `outro`, `stopped`) using `useEffect` timers with random variance constants (`SENTENCE_DURATION`, `SENTENCE_DURATION_VAR`).
  - Randomizes effects across categorized lists (intro/ambient/outro). Effect metadata stored in `SELECTED_EFFECTS` and `OUTRO_EFFECTS` arrays.
  - LocalStorage persistence (`STORAGE_KEY = 'existential-detective-effect-prefs'`) for toggling effects via modal library.
  - `handleSkipToOutro` allows clicking container to fast-forward.
- UI chrome controlled through state:
  - `menu-bar` visibility toggled by `mousemove` Y position.
  - Splash timer (`INTRO_DURATION`) fades to landing cards.
  - Modals for About and Effect Library.
  - Debug panel surfaces effect info when `VITE_DEBUG=true`.

## Target asset layout inside frontend/public

| Asset type | Final path | Source today |
| --- | --- | --- |
| Shared images (glass, measure, letters, cats, moon scans, cityscapes) | `/assets/imgs/**` | `frontend/public/assets/imgs/**` and `yang/public/imgs/**` |
| Background videos | `/assets/vids/waning_2160p30.mp4`, `/assets/vids/waxing_2160p30.mp4` | `frontend/public/assets/vids`, `yang/public/vids` |
| Poem content | `/data/poem.md` | `frontend/public/data/poem.md` (authoritative), also `yang/public/poem.md` (duplicate) |
| Chat JSON config | `/data/paper-config.json`, `/data/phil_annotations.json` | Already in `frontend/public/data` |

**Decisions**
- `frontend/public/assets` remains the single source for imagery/video. All Yang assets migrate here (no name changes required; existing filenames already match).
- Content files consolidate under `frontend/public/data`. `yang/public/poem.md` will be removed after `/p` consumes `/data/poem.md`.
- All static JS for router/chat/poem will live in `frontend/public/js`. New modules planned: `router.js`, `chat.js`, `poem.js` (per later steps).
- CSS ownership:
  - Chat styles stay in existing CSS files (left/right philosopher, note pages, chat paper, theme).
  - Landing visuals will move from `yang/src/App.css` into `frontend/public/css/landing.css`.
  - Poem presentation rules will consolidate into `frontend/public/css/poem.css`.

This satisfies Step 1 by documenting current dependencies and where future merged assets will reside.

## Step 7 – Asset Relocation Log (March 4, 2026)

All imagery and video referenced by the Yang prototype now lives under `frontend/public/assets`, so the static Express server is the single source of truth regardless of route. Two stragglers (`vecteezy_old-stack-of-vintage-papers-bound-with-twine_49216397.png` and the alternate `8468737400_27a8898820_o (1).jpg`) were copied from `yang/public` during this step.

| Original path (`yang/public/…`) | Current canonical path | Notes |
| --- | --- | --- |
| `imgs/glass.png`, `imgs/measure.png`, `imgs/letters.png` | `frontend/public/assets/imgs/{glass,measure,letters}.png` | Intro gallery cards |
| `imgs/black_cat_left_gaze.png`, `imgs/black_cat_right_gaze.png`, `imgs/pale_cale_up_right_gaze.png` | `frontend/public/assets/imgs/{black_cat_left_gaze,black_cat_right_gaze,pale_cale_up_right_gaze}.png` | Poem modals |
| `imgs/page17.png` – `imgs/page20.png` | `frontend/public/assets/imgs/page17.png` – `page20.png` | Landing gallery thumbs |
| `imgs/Apollo_17_Moon_Panorama.jpg` | `frontend/public/assets/imgs/Apollo_17_Moon_Panorama.jpg` | Landing backdrop texture |
| `imgs/vecteezy_old-stack-of-vintage-papers-bound-with-twine_49216397.png` | `frontend/public/assets/imgs/vecteezy_old-stack-of-vintage-papers-bound-with-twine_49216397.png` | Letters modal art |
| `imgs/cityscapes/*.jpg` (including `8468737400_27a8898820_o (1).jpg`) | `frontend/public/assets/imgs/cityscapes/*.jpg` | Background rotation for poem + future rituals |
| `vids/waning_2160p30.mp4`, `vids/waxing_2160p30.mp4` | `frontend/public/assets/vids/*.mp4` | Background video playlist |

Additional notes:
- `frontend/public/data/poem.md` is the authoritative content file for `/p`. The duplicate at `yang/public/poem.md` remains only so the legacy Vite project can still boot if needed.
- The `yang/` project stays in the repo for historical reference, but it is no longer part of the deployable surface; all imagery/video served to prod flows from `frontend/public` now.

### JS dependency status

- Yang previously bundled React, Vite, and `ogl` for three.js-style shaders. Step 5 replaced all poem/intro behaviors with vanilla modules inside `frontend/public/js`, so no additional browser dependencies are required beyond the Rough Notation CDN that was already in place for chat annotations.
- Any future animation helpers must be added via explicit `<script>` tags in `frontend/public/index.html`; there is no bundler in the production path.

## Step 8 – Tooling & Local Dev Confirmation

- The Express server in `frontend/server.js` continues to serve `frontend/public`, and `npm run dev` wraps it with `nodemon` so HTML/CSS/JS edits trigger an automatic reload.
- Azure Static Web Apps consumes `frontend/public/staticwebapp.config.json`, whose `navigationFallback.rewrite` already targets `/index.html`. No changes were required for the History API router, but we verified the config still excludes `/api/*` and `/assets/*` so binary assets bypass the fallback.
- Contributors should treat `frontend/` as the primary workspace. Running or building under `yang/` is optional and purely for archival comparison.
