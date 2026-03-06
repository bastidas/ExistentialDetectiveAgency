/**
 * Annotation config: fallback color, mode-to-RoughNotation types, and per-philosopher
 * settings for chat message markup (highlight, strike, keyword). Used by annotation.js.
 */
(function (global) {
  "use strict";

  /** Fallback color when no color array is provided (hex or CSS color name). */
  var ANNOTATION_DEFAULT_COLOR = "#5452ad";

  /** Map from rule mode to RoughNotation type names (one picked at random per span). */
  var ANNOTATION_MODE_TO_TYPES = {
    keyword: ["circle", "box", "underline"],
    highlight: ["bracket"], /** highlight was causing dispaly issues, remove */
    strike: ["strike-through", "crossed-off"],
  };

  /**
   * Per-philosopher annotation settings. Each side has its own colors (arrays for random pick),
   * animationDuration (ms), strokeWidth, padding, iterations, and bracketSides.
   */
  var ANNOTATION_PHILOSOPHER_SETTINGS = {
    left: {
      animationDuration: 700,
      strokeWidth: 1,
      padding: 5,
      iterations: 2,
      bracketSides: ["left", "right"],
      keywordColors: ["#5452ad"],
      highlightColors: ["#5452ad", "salmon", "#b8860b"],
      strikeColors: ["#8b0000", "#5452ad"],
    },
    right: {
      animationDuration: 800,
      strokeWidth: 2,
      padding: 4,
      iterations: 3,
      bracketSides: ["right", "left"],
      keywordColors: ["#284283"],
      highlightColors: ["#284283", "#5a7fb8"],
      strikeColors: ["#6b2d2d", "#284283"],
    },
  };

  global.AnnotationConfig = {
    ANNOTATION_DEFAULT_COLOR: ANNOTATION_DEFAULT_COLOR,
    ANNOTATION_MODE_TO_TYPES: ANNOTATION_MODE_TO_TYPES,
    ANNOTATION_PHILOSOPHER_SETTINGS: ANNOTATION_PHILOSOPHER_SETTINGS,
  };
})(typeof window !== "undefined" ? window : this);
