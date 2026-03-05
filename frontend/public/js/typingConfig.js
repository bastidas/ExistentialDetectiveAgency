(function (global) {
  "use strict";

  /**
   * Typing configuration for detective (assistant) chat replies.
   *
   * Edit these values to change how fast the assistant "types" and
   * whether long messages or reduced-motion users are animated.
   */
  var TYPING_CONFIG = {
    /** Number of characters revealed per animation step. */
    assistantCharsPerTick: 3,
    /** Delay between animation steps in milliseconds (base). */
    assistantTickMs: 50,
    /**
     * Optional random variation added to the base delay, in ms.
     * A value of 10 means each step delays by
     *   assistantTickMs + random(0..10).
     */
    assistantTickVariationMs: 30,
    /**
     * Maximum length (in characters) to animate. If a reply is longer than
     * this, it will be rendered instantly instead of typing it out.
     * Set to 0 or omit to animate the full reply regardless of length.
     */
    assistantMaxChars: 0,
    /**
     * When true, respects the user's `prefers-reduced-motion` setting and
     * skips the typing animation for those users.
     */
    respectReducedMotion: true,
  };

  // Attach on EDAUtils so other modules can read it easily.
  global.EDAUtils = global.EDAUtils || {};
  global.EDAUtils.TYPING_CONFIG = global.EDAUtils.TYPING_CONFIG || TYPING_CONFIG;

})(typeof window !== "undefined" ? window : this);
