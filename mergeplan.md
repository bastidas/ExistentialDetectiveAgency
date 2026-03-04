# Merge Plan: Unified Landing, Chat, and Poem Experiences

## Overview
Deliver a single static document (`frontend/public/index.html`) that contains the intro, chat, and poem experiences. A lightweight hash router (`#/`, `#/q`, `#/p`) will swap visibility without navigating away from the page, preserving simple hosting while enabling shareable deep links. The intro can be rebuilt semantically, but it must match the visual style and motion from `yang/index.html`. The querent/chat UI should look and behave exactly as it does today. The chat session must remain alive when the user navigates away from `/q` and returns.

## Implementation Steps

### 1. Inventory & Prep
- Catalog all assets, fonts, and scripts currently used by `frontend/public` (chat) and `yang` (intro + poem), noting their file paths and dependencies.
- Identify React-specific code in `yang/src/App.tsx` that drives poem timers and the background video so we know what must be reimplemented in vanilla JS.
- Decide on final target directories inside `frontend/public` for shared assets (`/assets/imgs`, `/assets/vids`, `/data`).

### 2. Build the Consolidated HTML Skeleton
- Start from `frontend/public/index.html` and embed three sibling sections: `route-intro`, `route-chat`, `route-poem`.
- Recreate the intro section markup so it replicates the Yang layout (hero copy, cards, transitions) while pointing the glass card to `#/q`. Other cards should use placeholder hashes until their experiences exist.
- Drop the existing chat DOM wholesale into `route-chat` so no selectors change. Include a “Back to Agency” anchor per section pointing to `#/`.

### 3. Router & Lifecycle Glue
- Create `frontend/public/js/router.js` that exports `initRouter()`. Responsibilities:
  - Normalize hashes (`#/`, `#/q`, `#/p`) and default to intro when missing/unknown.
  - Toggle `.route--active` on the target section and `.route--hidden` on others.
  - Maintain booleans such as `chatBootstrapped` and `poemBootstrapped` so initialization happens once.
  - Call `initChat()` the first time `/q` appears, but only hide/show the chat container afterward so sockets/API sessions stay alive.
  - Call `initPoem()` the first time `/p` appears; expose `showPoem()` / `hidePoem()` hooks for pausing timers/video when the user leaves.
  - Update `document.title` per route.
- Wire `initRouter()` from a script tag at the bottom of `index.html` after other modules load.

### 4. Chat Integration (`/q`)
- Gather every script/style tag currently required for the querent experience (UI scripts, shared helpers, CSS files) and ensure they still load globally before the router runs.
- Extract runtime setup (API keys, sockets, DOM listeners) into `frontend/public/js/chat.js` with `initChat()`. This function should guard against duplicate bindings and store references needed for cleanup.
- Provide `showChat()` / `hideChat()` helpers that only add/remove `route--hidden` so the active session persists off-screen.

### 5. Poem Port (`/p`)
- Move `yang/public/poem.md` into `frontend/public/data/poem.md` and update fetch paths.
- Create `frontend/public/js/poem.js` that reimplements the required features from React: timing logic and the looping background video. Use plain objects/state to mirror the original behavior (e.g., `poemState.effect`, `poemState.timerId`).
- Replace React hooks with DOM selectors + event listeners for effect buttons, timer controls, and outro triggers. Persist any user selections via `localStorage` if currently supported.
- Ensure the background video asset migrates into `frontend/public/assets/vids` and is lazily loaded when `/p` activates to avoid penalizing the intro route.

### 6. Styling Strategy
- Keep all existing chat CSS files inside `frontend/public/css/` untouched to guarantee parity.
- Extract intro-specific rules from `yang/src/App.css` into `frontend/public/css/landing.css`, recreating typography, glass effects, and scroll staging exactly as seen today.
- Extract poem-specific rules (reader layout, controls, background video overlays) into `frontend/public/css/poem.css`.
- Update `frontend/public/css/theme.css` with any shared variables/fonts needed by the new sections.
- Add `.route--active` / `.route--hidden` utility classes (display toggles + opacity transitions) used by the router.

### 7. Assets & Dependencies
- Relocate Yang images, videos, and SVGs into the `frontend/public/assets` hierarchy and update all references. Keep a mapping doc to avoid broken links.
- Ensure any JS dependencies previously bundled by Vite (e.g., animation libs) are either replaced with vanilla code or pulled in via static `<script>` tags.
- Leave the `yang/` project in place for reference after migration; document that it is no longer part of the build/deploy path.

### 8. Tooling & Local Dev
- Continue serving `frontend/public` via the existing static dev server. Confirm it automatically reloads on HTML/CSS/JS changes.
- No changes are required for `staticwebapp.config.json` beyond confirming the fallback to `/index.html` remains.
- Update package scripts or docs if the primary `npm run dev` command should now run from `frontend/` only.

### 9. Verification & Sign-off
- Manual test matrix:
  - Load `/`, `/#/q`, and `/#/p` directly and via in-page navigation.
  - Confirm the chat session stays connected when switching to intro/poem and back.
  - Verify poem timers and background video pause/resume correctly when routes change.
  - Validate assets load from their new paths and no console errors occur.
  - Check focus management (move focus to top of each section on route change) and ARIA labels for the intro cards.
- Update `README.md` (and any deployment docs) with instructions for the new hash routes and asset locations.
