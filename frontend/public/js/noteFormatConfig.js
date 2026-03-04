/**
 * Unified note format configuration for left and right philosopher notes.
 * Single source of truth for line height, padding, opacity, color, and
 * content-height scaling. Load before notePages.js.
 */
(function (global) {
  "use strict";

  var RESPONSIVE_STEPS = [
    { mode: "mobile-xs", max: 480, noteScale: 0.6, fontScale: 0.85 },
    { mode: "mobile-sm", max: 640, noteScale: 0.68, fontScale: 0.88 },
    { mode: "mobile", max: 768, noteScale: 0.76, fontScale: 0.9 },
    { mode: "medium", max: 1440, noteScale: 0.94, fontScale: 0.97 },
  ];
  var RESPONSIVE_WIDE = { mode: "desktop-wide", min: 2000, noteScale: 1.05, fontScale: 1.02 };
  var RESPONSIVE_BASE = { mode: "desktop-base", noteScale: 1, fontScale: 1 };
  var responsiveState = { mode: RESPONSIVE_BASE.mode, noteScale: RESPONSIVE_BASE.noteScale, fontScale: RESPONSIVE_BASE.fontScale };

  var PAPER_REFERENCE_SIZE = { width: 440, height: 560 };
  var NOTE_BASE_WIDTH = 340;
  var NOTE_BASE_SIZE = {
    width: NOTE_BASE_WIDTH,
    height: Math.round(NOTE_BASE_WIDTH * (PAPER_REFERENCE_SIZE.height / PAPER_REFERENCE_SIZE.width)),
  };

  /**
   * Philosopher-specific note content styles (note-page__content). Keys match CSS vars --note-*.
   * Optional paperPaddingRightOverride: use this value instead of the paper's padding.right for
   * the writable area (e.g. 0 to reduce the left philosopher's right margin).
   */
  var NOTE_FORMAT = {
    left: {
      lineHeight: 1.45,
      paddingTop: "5%",
      paddingRight: "10%",
      paddingBottom: "5%",
      paddingLeft: "8%",
      opacity: 0.98,
      color: "#202024",
      fontSize: "1.05rem",
      fontFamily: '"Annie Use Your Telescope", cursive',
      /*paperPaddingRightOverride: 0,*/
    },
    right: {
      lineHeight: 1.65,
      paddingTop: "5%",
      paddingRight: "10%",
      paddingBottom: "11%",
      paddingLeft: "4%",
      opacity: 0.93,
      color: "#284283",
      fontSize: "1.12rem",
      fontFamily: '"Homemade Apple", cursive',
    },
  };

  /**
   * Scaling for getContentUsedHeight: raw sum of child offsetHeights is multiplied by
   * base * (side === "right" ? right : left). Tune how "tall" each philosopher's content counts for fitting.
   */
  var CONTENT_HEIGHT_SCALING = {
    base: 1,
    left: 1,
    right: 1,
  };

  /**
   * Estimated line height in px for height estimation (need_new_note, estimateHeightForText).
   * Must match the actual visual line height so we don't underestimate and draw new text on top of existing.
   * Right: .line height + padding-bottom = 3rem + 24px + 1.5em (see note-pages.css .right-philosopher .note-page__content .line).
   */
  var ESTIMATE_LINE_HEIGHT_PX = {
    left: 40,
    right: 0,
  };

  /** Default padding (percent) when paper is not in PAPER_CONFIG */
  var DEFAULT_PAPER_PADDING = { top: 17.5, right: 17.5, bottom: 17.5, left: 17.5 };

  var DEFAULT_PAPER_SCALE = 1;

  /**
   * Paper image path -> { padding %, widthFactor, heightFactor, scale }.
   * Factors are derived from the legacy px values in data/paper-config.json so relative sizing stays intact
   * while NOTE_BASE_SIZE controls the absolute canvas.
   */
  var PAPER_CONFIG = {};

  /**
   * Get paper padding (percent). If side is "left" and NOTE_FORMAT.left.paperPaddingRightOverride
   * is set, that value is used for right (so you can reduce the left philosopher's right margin).
   */
  function getPaperPadding(paperUrl, side) {
    var entry = PAPER_CONFIG[paperUrl];
    if (!entry || !entry.padding) return DEFAULT_PAPER_PADDING;
    var pad = {
      top: Number(entry.padding.top) != null ? Number(entry.padding.top) : DEFAULT_PAPER_PADDING.top,
      right: Number(entry.padding.right) != null ? Number(entry.padding.right) : DEFAULT_PAPER_PADDING.right,
      bottom: Number(entry.padding.bottom) != null ? Number(entry.padding.bottom) : DEFAULT_PAPER_PADDING.bottom,
      left: Number(entry.padding.left) != null ? Number(entry.padding.left) : DEFAULT_PAPER_PADDING.left,
    };
    if (side === "left") {
      var leftFormat = NOTE_FORMAT.left;
      if (leftFormat && leftFormat.paperPaddingRightOverride != null) {
        pad.right = Number(leftFormat.paperPaddingRightOverride);
        if (pad.right < 0) pad.right = 0;
      }
    }
    return pad;
  }

  function getPaperSize(paperUrl) {
    var entry = PAPER_CONFIG[paperUrl];
    var widthFactor = entry && typeof entry.widthFactor === "number" ? entry.widthFactor : 1;
    var heightFactor = entry && typeof entry.heightFactor === "number" ? entry.heightFactor : 1;
    var scale = entry && typeof entry.scale === "number" ? entry.scale : DEFAULT_PAPER_SCALE;
    if (!scale || scale <= 0) scale = DEFAULT_PAPER_SCALE;
    if (!widthFactor || widthFactor <= 0) widthFactor = 1;
    if (!heightFactor || heightFactor <= 0) heightFactor = 1;
    var responsiveScale = getResponsiveNoteScale();
    return {
      width: Math.round(NOTE_BASE_SIZE.width * widthFactor * scale * responsiveScale),
      height: Math.round(NOTE_BASE_SIZE.height * heightFactor * scale * responsiveScale),
    };
  }

  function getWritableAreaSize(paperUrl, side) {
    var size = getPaperSize(paperUrl);
    var pad = getPaperPadding(paperUrl, side);
    return {
      width: size.width * (1 - (pad.left + pad.right) / 100),
      height: size.height * (1 - (pad.top + pad.bottom) / 100),
    };
  }

  /**
   * Paper image URLs in config order. Use this as the single source for the note paper list.
   */
  function getPaperImages() {
    return Object.keys(PAPER_CONFIG);
  }

  function sanitizeScale(value, fallback) {
    var numeric = Number(value);
    if (!isNaN(numeric) && numeric > 0) return numeric;
    if (typeof fallback === "number" && fallback > 0) return fallback;
    return DEFAULT_PAPER_SCALE;
  }

  function deriveDimensionFactor(rawValue, referenceValue, fallbackFactor) {
    var numeric = Number(rawValue);
    if (!isNaN(numeric) && numeric > 0 && referenceValue > 0) {
      return numeric / referenceValue;
    }
    if (typeof fallbackFactor === "number" && fallbackFactor > 0) {
      return fallbackFactor;
    }
    return 1;
  }

  /**
   * Load data/paper-config.json and merge into PAPER_CONFIG.
   * Call once at startup; notes created after it resolves use the JSON values.
   */
  function loadPaperConfigJson() {
    return fetch("data/paper-config.json")
      .then(function (res) {
        return res.ok ? res.json() : Promise.reject(new Error("paper-config.json " + res.status));
      })
      .then(function (data) {
        var key;
        for (key in data) {
          if (key === "paperImages" && Array.isArray(data[key])) continue;
          if (!Object.prototype.hasOwnProperty.call(data, key) || !data[key] || typeof data[key] !== "object") continue;
          var raw = data[key];
          var existing = PAPER_CONFIG[key];
          var padding = raw.padding && typeof raw.padding === "object"
            ? {
                top: Number(raw.padding.top) != null ? Number(raw.padding.top) : DEFAULT_PAPER_PADDING.top,
                right: Number(raw.padding.right) != null ? Number(raw.padding.right) : DEFAULT_PAPER_PADDING.right,
                bottom: Number(raw.padding.bottom) != null ? Number(raw.padding.bottom) : DEFAULT_PAPER_PADDING.bottom,
                left: Number(raw.padding.left) != null ? Number(raw.padding.left) : DEFAULT_PAPER_PADDING.left,
              }
            : (existing && existing.padding) || DEFAULT_PAPER_PADDING;
          var widthFallback = existing && (typeof existing.widthFactor === "number" ? existing.widthFactor : (typeof existing.width === "number" ? existing.width / PAPER_REFERENCE_SIZE.width : null));
          var heightFallback = existing && (typeof existing.heightFactor === "number" ? existing.heightFactor : (typeof existing.height === "number" ? existing.height / PAPER_REFERENCE_SIZE.height : null));
          var widthFactor = deriveDimensionFactor(raw.width, PAPER_REFERENCE_SIZE.width, widthFallback);
          var heightFactor = deriveDimensionFactor(raw.height, PAPER_REFERENCE_SIZE.height, heightFallback);
          var scale = sanitizeScale(raw.scale, existing && existing.scale);
          PAPER_CONFIG[key] = {
            padding: padding,
            widthFactor: widthFactor,
            heightFactor: heightFactor,
            scale: scale,
          };
        }
        return PAPER_CONFIG;
      })
      .catch(function (err) {
        console.warn("[NoteFormatConfig] Could not load data/paper-config.json:", err.message);
        return PAPER_CONFIG;
      });
  }

  function getNoteFormat(side) {
    return NOTE_FORMAT[side] || NOTE_FORMAT.left;
  }

  function getContentHeightScale(side) {
    var s = CONTENT_HEIGHT_SCALING;
    return s.base * (side === "right" ? s.right : s.left);
  }

  function getEstimatedLineHeightPx(side) {
    var explicit = ESTIMATE_LINE_HEIGHT_PX[side];
    if (typeof explicit === "number" && explicit > 0) return explicit;
    var format = NOTE_FORMAT[side] || NOTE_FORMAT.left || {};
    var fontSizePx = parseFontSizePx(format.fontSize);
    var lineHeight = typeof format.lineHeight === "number" ? format.lineHeight : parseFloat(format.lineHeight);
    if (!lineHeight || !isFinite(lineHeight)) lineHeight = 1.4;
    var computed = fontSizePx * lineHeight;
    return computed > 0 ? computed : 40;
  }

  /**
   * Reference content width (px) for the default chars-per-line estimate (notePages.js).
   * 440 * (1 - 0.175 - 0.175) = 286.
   */
  var REFERENCE_CONTENT_WIDTH_PX = 286;
  var REFERENCE_CHARS_PER_LINE = 40;

  function parseFontSizePx(val) {
    if (typeof val === "number" && !isNaN(val)) return val;
    if (!val) return 16;
    var str = String(val).trim();
    if (!str) return 16;
    if (str.toLowerCase().indexOf("rem") !== -1) {
      return 16 * (parseFloat(str) || 1);
    }
    if (str.toLowerCase().indexOf("em") !== -1) {
      return 16 * (parseFloat(str) || 1);
    }
    if (str.toLowerCase().indexOf("px") !== -1) {
      return parseFloat(str) || 16;
    }
    var numeric = parseFloat(str);
    return !isNaN(numeric) ? numeric : 16;
  }

  /**
   * Parse percentage string (e.g. "15%", "0%") to number 0..100.
   */
  function parsePaddingPercent(val) {
    if (val == null) return 0;
    if (typeof val === "number" && !isNaN(val)) return val;
    var s = String(val).trim();
    if (s.indexOf("%") !== -1) return Math.max(0, Math.min(100, parseFloat(s) || 0));
    return parseFloat(s) || 0;
  }

  function getContentInsetPercent(side) {
    var format = side === "right" ? (NOTE_FORMAT.right || {}) : (NOTE_FORMAT.left || {});
    return parsePaddingPercent(format.paddingLeft) + parsePaddingPercent(format.paddingRight);
  }

  /**
   * Chars per line for a given side, for the narrowest configured paper (worst case for line count).
   * Used by notePages.estimateHeightForText so need_new_note uses correct line count per philosopher.
   */
  function estimateCharsPerLineForPaper(paperUrl, side) {
    var inset = getContentInsetPercent(side);
    var writable = getWritableAreaSize(paperUrl, side);
    var effectiveWidth = writable.width * (1 - inset / 100);
    var chars = Math.round(REFERENCE_CHARS_PER_LINE * (effectiveWidth / REFERENCE_CONTENT_WIDTH_PX));
    return chars > 0 ? chars : REFERENCE_CHARS_PER_LINE;
  }

  function getEstimateCharsPerLine(side) {
    var papers = getPaperImages();
    if (!papers.length) return REFERENCE_CHARS_PER_LINE;
    var minChars = Infinity;
    for (var i = 0; i < papers.length; i++) {
      var chars = estimateCharsPerLineForPaper(papers[i], side);
      if (chars < minChars) minChars = chars;
    }
    return (minChars !== Infinity && minChars > 0) ? minChars : REFERENCE_CHARS_PER_LINE;
  }

  /**
   * Maximum approximate characters per line across all configured papers and both philosophers.
   * Uses NOTE_FORMAT padding so the left philosopher's content padding (e.g. 15% left) is
   * accounted for; the hint reflects the actual writable width, especially for the left panel.
   */
  function getContentWidthCharsForHint() {
    var papers = getPaperImages();
    if (!papers.length) return REFERENCE_CHARS_PER_LINE;
    var maxChars = 0;
    for (var i = 0; i < papers.length; i++) {
      var paperUrl = papers[i];
      var leftChars = estimateCharsPerLineForPaper(paperUrl, "left");
      var rightChars = estimateCharsPerLineForPaper(paperUrl, "right");
      var chars = Math.max(leftChars, rightChars);
      if (chars > maxChars) maxChars = chars;
    }
    return maxChars || REFERENCE_CHARS_PER_LINE;
  }

  /**
   * Apply NOTE_FORMAT as CSS custom properties (--note-*) on the philosopher panel roots
   * so panel CSS can use var(--note-fontFamily), var(--note-color), etc. Call once at app init.
   */
  function applyNoteFormatToPanels() {
    if (typeof document === "undefined") return;
    var leftEl = document.getElementById("left-philosopher");
    var rightEl = document.getElementById("right-philosopher");
    var leftFormat = getNoteFormat("left");
    var rightFormat = getNoteFormat("right");
    var propKeys = ["lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "opacity", "color", "fontSize", "fontFamily"];
    function apply(el, format) {
      if (!el || !format) return;
      for (var i = 0; i < propKeys.length; i++) {
        var key = propKeys[i];
        var val = format[key];
        if (val != null) el.style.setProperty("--note-" + key, val);
      }
    }
    apply(leftEl, leftFormat);
    apply(rightEl, rightFormat);
    applyResponsiveViewportScales();
  }

  function resolveResponsiveState(width) {
    if (typeof width !== "number" || !isFinite(width) || width <= 0) {
      return { mode: RESPONSIVE_BASE.mode, noteScale: RESPONSIVE_BASE.noteScale, fontScale: RESPONSIVE_BASE.fontScale };
    }
    if (width >= RESPONSIVE_WIDE.min) {
      return { mode: RESPONSIVE_WIDE.mode, noteScale: RESPONSIVE_WIDE.noteScale, fontScale: RESPONSIVE_WIDE.fontScale };
    }
    for (var i = 0; i < RESPONSIVE_STEPS.length; i++) {
      var step = RESPONSIVE_STEPS[i];
      if (width <= step.max) {
        return { mode: step.mode, noteScale: step.noteScale, fontScale: step.fontScale };
      }
    }
    return { mode: RESPONSIVE_BASE.mode, noteScale: RESPONSIVE_BASE.noteScale, fontScale: RESPONSIVE_BASE.fontScale };
  }

  var responsiveListeners = [];

  function notifyResponsiveListeners() {
    if (!responsiveListeners.length) return;
    for (var i = 0; i < responsiveListeners.length; i++) {
      try {
        responsiveListeners[i](responsiveState);
      } catch (err) {
        console.error("[NoteFormatConfig] responsive listener error", err);
      }
    }
  }

  function applyResponsiveViewportScales() {
    var width = typeof window !== "undefined" ? window.innerWidth : null;
    var nextState = resolveResponsiveState(width);
    var changed = !responsiveState ||
      nextState.mode !== responsiveState.mode ||
      nextState.noteScale !== responsiveState.noteScale ||
      nextState.fontScale !== responsiveState.fontScale;
    responsiveState = nextState;
    if (typeof document !== "undefined" && document.documentElement) {
      var root = document.documentElement;
      root.style.setProperty("--note-responsive-scale", String(responsiveState.noteScale));
      root.style.setProperty("--note-responsive-font-scale", String(responsiveState.fontScale));
    }
    if (changed) notifyResponsiveListeners();
  }

  function getResponsiveNoteScale() {
    return responsiveState.noteScale || RESPONSIVE_BASE.noteScale;
  }

  function getResponsiveFontScale() {
    return responsiveState.fontScale || RESPONSIVE_BASE.fontScale;
  }

  function onResponsiveScaleChange(listener) {
    if (typeof listener !== "function") {
      return function noop() {};
    }
    responsiveListeners.push(listener);
    return function unsubscribe() {
      var idx = responsiveListeners.indexOf(listener);
      if (idx >= 0) responsiveListeners.splice(idx, 1);
    };
  }

  var resizeTimeoutId = null;
  function handleViewportResize() {
    if (resizeTimeoutId) clearTimeout(resizeTimeoutId);
    resizeTimeoutId = setTimeout(function () {
      resizeTimeoutId = null;
      applyResponsiveViewportScales();
    }, 150);
  }

  global.NoteFormatConfig = {
    NOTE_FORMAT: NOTE_FORMAT,
    CONTENT_HEIGHT_SCALING: CONTENT_HEIGHT_SCALING,
    ESTIMATE_LINE_HEIGHT_PX: ESTIMATE_LINE_HEIGHT_PX,
    PAPER_CONFIG: PAPER_CONFIG,
    getPaperPadding: getPaperPadding,
    getPaperSize: getPaperSize,
    getWritableAreaSize: getWritableAreaSize,
    getPaperImages: getPaperImages,
    getNoteFormat: getNoteFormat,
    getContentHeightScale: getContentHeightScale,
    getEstimatedLineHeightPx: getEstimatedLineHeightPx,
    getEstimateCharsPerLine: getEstimateCharsPerLine,
    estimateCharsPerLineForPaper: estimateCharsPerLineForPaper,
    getContentWidthCharsForHint: getContentWidthCharsForHint,
    getResponsiveNoteScale: getResponsiveNoteScale,
    getResponsiveFontScale: getResponsiveFontScale,
    onResponsiveScaleChange: onResponsiveScaleChange,
    loadPaperConfigJson: loadPaperConfigJson,
    applyNoteFormatToPanels: applyNoteFormatToPanels,
  };

  if (typeof window !== "undefined") {
    loadPaperConfigJson();
    applyResponsiveViewportScales();
    window.addEventListener("resize", handleViewportResize);
  }
})(typeof window !== "undefined" ? window : this);
