/**
 * Unified note format configuration for left and right philosopher notes.
 * Single source of truth for line height, padding, opacity, color, and
 * content-height scaling. Load before notePages.js.
 */
(function (global) {
  "use strict";

  /**
   * Philosopher-specific note content styles (note-page__content). Keys match CSS vars --note-*.
   * Optional paperPaddingRightOverride: use this value instead of the paper's padding.right for
   * the writable area (e.g. 0 to reduce the left philosopher's right margin).
   */
  var NOTE_FORMAT = {
    left: {
      lineHeight: 1.45,
      paddingTop: "5%",
      paddingRight: "15%",
      paddingBottom: "5%",
      paddingLeft: "15%",
      opacity: 0.98,
      color: "#202024",
      fontSize: "1.15rem",
      fontFamily: '"Annie Use Your Telescope", cursive',
      /*paperPaddingRightOverride: 0,*/
    },
    right: {
      lineHeight: 1.65,
      paddingTop: "0%",
      paddingRight: "12%",
      paddingBottom: "11%",
      paddingLeft: "10%",
      opacity: 0.93,
      color: "#284283",
      fontSize: "1.2rem",
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

  /** Default size (px) when paper is not in PAPER_CONFIG; scale is unitless, default 1 */
  var DEFAULT_PAPER_SIZE = { width: 440, height: 560, scale: 1 };

  /**
   * Paper image path -> { padding: { top, right, bottom, left } %, width px, height px, scale? }.
   * Loaded from data/paper-config.json on init. Keys define the paper list (PAPER_IMAGES).
   */
  var PAPER_CONFIG = {
    "imgs/paper3.png": {
      padding: { top: 16.5, right: 3.5, bottom: 16.5, left: 6.5 },
      width: 440,
      height: 560,
      scale: 1,
    },
    "imgs/paper4.webp": {
      padding: { top: 11, right: 3, bottom: 11, left: 12 },
      width: 440,
      height: 560,
      scale: 2.25,
    },
  };

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
    if (!entry) return { width: DEFAULT_PAPER_SIZE.width, height: DEFAULT_PAPER_SIZE.height };
    var w = Number(entry.width) || DEFAULT_PAPER_SIZE.width;
    var h = Number(entry.height) || DEFAULT_PAPER_SIZE.height;
    var scale = Number(entry.scale) || 1;
    if (!scale || scale <= 0) scale = 1;
    return {
      width: Math.round(w * scale),
      height: Math.round(h * scale),
    };
  }

  /**
   * Paper image URLs in config order. Use this as the single source for the note paper list.
   */
  function getPaperImages() {
    return Object.keys(PAPER_CONFIG);
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
          var width = Number(raw.width) || (existing && existing.width) || DEFAULT_PAPER_SIZE.width;
          var height = Number(raw.height) || (existing && existing.height) || DEFAULT_PAPER_SIZE.height;
          var scale = raw.scale != null ? (Number(raw.scale) || 1) : (existing && existing.scale != null ? existing.scale : 1);
          PAPER_CONFIG[key] = {
            padding: padding,
            width: width,
            height: height,
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

  /**
   * Reference content width (px) for the default chars-per-line estimate (notePages.js).
   * 440 * (1 - 0.175 - 0.175) = 286.
   */
  var REFERENCE_CONTENT_WIDTH_PX = 286;
  var REFERENCE_CHARS_PER_LINE = 40;

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

  /**
   * Chars per line for a given side, for the narrowest configured paper (worst case for line count).
   * Used by notePages.estimateHeightForText so need_new_note uses correct line count per philosopher.
   */
  function getEstimateCharsPerLine(side) {
    var papers = getPaperImages();
    if (!papers.length) return REFERENCE_CHARS_PER_LINE;
    var leftFormat = NOTE_FORMAT.left || {};
    var rightFormat = NOTE_FORMAT.right || {};
    var leftInset = parsePaddingPercent(leftFormat.paddingLeft) + parsePaddingPercent(leftFormat.paddingRight);
    var rightInset = parsePaddingPercent(rightFormat.paddingLeft) + parsePaddingPercent(rightFormat.paddingRight);
    var minChars = Infinity;
    for (var i = 0; i < papers.length; i++) {
      var paperUrl = papers[i];
      var size = getPaperSize(paperUrl);
      var pad = getPaperPadding(paperUrl, side);
      var contentWidthPx = size.width * (1 - (pad.left + pad.right) / 100);
      var inset = side === "right" ? rightInset : leftInset;
      var effective = contentWidthPx * (1 - inset / 100);
      var chars = Math.round(REFERENCE_CHARS_PER_LINE * (effective / REFERENCE_CONTENT_WIDTH_PX));
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
    var leftFormat = NOTE_FORMAT.left || {};
    var rightFormat = NOTE_FORMAT.right || {};
    var leftInset = parsePaddingPercent(leftFormat.paddingLeft) + parsePaddingPercent(leftFormat.paddingRight);
    var rightInset = parsePaddingPercent(rightFormat.paddingLeft) + parsePaddingPercent(rightFormat.paddingRight);
    var maxChars = 0;
    for (var i = 0; i < papers.length; i++) {
      var paperUrl = papers[i];
      var size = getPaperSize(paperUrl);
      var padLeft = getPaperPadding(paperUrl, "left");
      var padRight = getPaperPadding(paperUrl, "right");
      var contentWidthPxLeft = size.width * (1 - (padLeft.left + padLeft.right) / 100);
      var contentWidthPxRight = size.width * (1 - (padRight.left + padRight.right) / 100);
      var leftEffective = contentWidthPxLeft * (1 - leftInset / 100);
      var rightEffective = contentWidthPxRight * (1 - rightInset / 100);
      var leftChars = Math.round(REFERENCE_CHARS_PER_LINE * (leftEffective / REFERENCE_CONTENT_WIDTH_PX));
      var rightChars = Math.round(REFERENCE_CHARS_PER_LINE * (rightEffective / REFERENCE_CONTENT_WIDTH_PX));
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
  }

  global.NoteFormatConfig = {
    NOTE_FORMAT: NOTE_FORMAT,
    CONTENT_HEIGHT_SCALING: CONTENT_HEIGHT_SCALING,
    ESTIMATE_LINE_HEIGHT_PX: ESTIMATE_LINE_HEIGHT_PX,
    PAPER_CONFIG: PAPER_CONFIG,
    getPaperPadding: getPaperPadding,
    getPaperSize: getPaperSize,
    getPaperImages: getPaperImages,
    getNoteFormat: getNoteFormat,
    getContentHeightScale: getContentHeightScale,
    getEstimateCharsPerLine: getEstimateCharsPerLine,
    getContentWidthCharsForHint: getContentWidthCharsForHint,
    loadPaperConfigJson: loadPaperConfigJson,
    applyNoteFormatToPanels: applyNoteFormatToPanels,
  };

  if (typeof window !== "undefined") {
    loadPaperConfigJson();
  }
})(typeof window !== "undefined" ? window : this);
