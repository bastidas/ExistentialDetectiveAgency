(function (global) {
  "use strict";

  /**
   * Typing configuration for detective / attaché chat replies
   * on the frontend.
   *
   * These values control how quickly text that is already known
   * client-side is "typed" into the DOM by EDAUtils.animateAssistantText.
   * They do NOT control backend streaming speed; the server-side
   * /api/chat-stream throttle lives in frontend/api/src/config.js
   * as STREAM_CHUNK_SIZE and STREAM_DELAY_MS.
   *
   * Rough rule of thumb:
   * - More characters per tick  → faster
   * - Fewer milliseconds per tick → faster
   * - Larger tick variation → more jittery / "human"
   */
  var TYPING_CONFIG = {
    /**
     * Number of characters revealed per animation step for assistant
     * (detective / attaché) replies that use animateAssistantText.
     * Higher values make the on-screen typing appear faster.
     */
    assistantCharsPerTick: 4,
    /**
     * Base delay between animation steps in milliseconds.
     * Lower values reduce the time between chunks and make typing
     * look faster; higher values slow it down.
     */
    assistantTickMs: 20,
    /**
     * Optional random variation added to the base delay, in ms.
     * A value of 10 means each step delays by
     *   assistantTickMs + random(0..10).
     */
    assistantTickVariationMs: 10,
    /**
     * Maximum length (in characters) to animate. If a reply is longer than
     * this, it will be rendered instantly instead of typing it out.
     * Set to 0 or omit to animate the full reply regardless of length.
     * This is a guardrail for very long responses so they don't take an
     * extremely long time to reveal one chunk at a time.
     */
    assistantMaxChars: 2000,
    /**
     * When true, respects the user's `prefers-reduced-motion` setting and
     * skips the typing animation for those users.
     */
    respectReducedMotion: true,
  };

  // In dev mode, make assistant typing extremely fast for rapid iteration.
  // Run this after the DOM is ready so body[data-dev-mode] is available.
  function applyDevTypingOverride() {
    try {
      if (
        typeof document !== "undefined" &&
        document.body &&
        document.body.dataset &&
        document.body.dataset.devMode === "true"
      ) {
        TYPING_CONFIG.assistantCharsPerTick = 1000;
        TYPING_CONFIG.assistantTickMs = 0;
        TYPING_CONFIG.assistantTickVariationMs = 0;
        TYPING_CONFIG.assistantMaxChars = 1;
      }
    } catch (e) {}
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applyDevTypingOverride);
    } else {
      applyDevTypingOverride();
    }
  }

  // Also consult /api/config directly so we honor DEV even if
  // body[data-dev-mode] is applied later or on non-chat routes.
  try {
    if (typeof fetch === "function") {
      fetch("/api/config", { credentials: "same-origin" })
        .then(function (res) { return res && res.ok ? res.json() : null; })
        .then(function (cfg) {
          if (cfg && cfg.devMode) {
            TYPING_CONFIG.assistantCharsPerTick = 1000;
            TYPING_CONFIG.assistantTickMs = 0;
            TYPING_CONFIG.assistantTickVariationMs = 0;
            TYPING_CONFIG.assistantMaxChars = 1;
          }
        })
        .catch(function () {});
    }
  } catch (e) {}

  // Attach on EDAUtils so other modules can read it easily.
  global.EDAUtils = global.EDAUtils || {};
  global.EDAUtils.TYPING_CONFIG = global.EDAUtils.TYPING_CONFIG || TYPING_CONFIG;

})(typeof window !== "undefined" ? window : this);
