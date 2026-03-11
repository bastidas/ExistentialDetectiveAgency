/**
 * Unified note format configuration for left and right philosopher notes.
 * Layout/sizing only: line height, padding, font scaling, areas. Font size, color, weight, and
 * opacity come from philosopherDisplay.config.js (getPhilosopherBaseStyle). Load before notePages.js.
 */
(function (global) {
  "use strict";

  // Single source of truth: viewport.breakpointsConfig.js (EDABreakpoints.RESPONSIVE_BANDS).
  // Bands are read at runtime via getResponsiveBands() so viewport always wins. Fallback only when viewport not loaded; do not edit.
  var FALLBACK_RESPONSIVE_BANDS = [
    { mode: "mobile-xs",   min: 0,    max: 480,  noteScale: 0.58, fontScale: 0.8 },
    { mode: "mobile-sm",   min: 481,  max: 640,  noteScale: 0.65, fontScale: 0.85 },
    { mode: "mobile",      min: 641,  max: 768,  noteScale: 0.76, fontScale: 0.9 },
    { mode: "medium",      min: 769,  max: 1440, noteScale: 0.8,  fontScale: 0.9 },
    { mode: "desktop-base",min: 1441, max: 1999, noteScale: 1,    fontScale: 1.0 },
    { mode: "desktop-wide",min: 2000, max: Infinity, noteScale: 1.05, fontScale: 1.05 },
  ];

  function getResponsiveBands() {
    var bp = global.EDABreakpoints;
    if (bp && bp.RESPONSIVE_BANDS && bp.RESPONSIVE_BANDS.length) {
      return bp.RESPONSIVE_BANDS;
    }
    return FALLBACK_RESPONSIVE_BANDS;
  }

  var RESPONSIVE_BASE = (function () {
    var bands = getResponsiveBands();
    for (var i = 0; i < bands.length; i++) {
      if (bands[i].mode === "desktop-base") {
        return {
          mode: bands[i].mode,
          noteScale: bands[i].noteScale,
          fontScale: bands[i].fontScale,
        };
      }
    }
    return { mode: "desktop-base", noteScale: 1, fontScale: 1 };
  })();

  var responsiveState = { mode: RESPONSIVE_BASE.mode, noteScale: RESPONSIVE_BASE.noteScale, fontScale: RESPONSIVE_BASE.fontScale };

  // Base visual paper size used for all papers before per-paper scale and responsive scale.
  // Previously derived from PAPER_REFERENCE_SIZE; now hard-coded to preserve the same 340x433 canvas.
  var NOTE_BASE_SIZE = { width: 340, height: 440 };

  /**
   * Philosopher-specific layout/sizing (line height, padding). Font size, color, weight, opacity, and
   * fontFamily come from philosopherDisplay.config.js and are merged in getNoteFormat().
   */
  var NOTE_FORMAT = {
    left: {
      lineHeight: 0.9,
      paddingTop: "1%",
      paddingRight: "1%",
      paddingBottom: "1%",
      paddingLeft: "1%",
      /*paperPaddingRightOverride: 0,*/
    },
    right: {
      lineHeight: 1.35,
      paddingTop: "1%",
      paddingRight: "1%",
      paddingBottom: "1%",
      paddingLeft: "1%",
    },
  };

  /**
   * Scaling for getContentUsedHeight: raw sum of child offsetHeights is multiplied by
   * base * (side === "right" ? right : left). Tune how "tall" each philosopher's content counts for fitting.
//   Used only in getContentHeightScale(side) → notePages.getContentUsedHeight().
// When we measure how much of the current note is “used,” we sum the children’s offsetHeight and multiply by this scale (base * left or base * right).
// So it only affects how tall we think the existing content is, not the estimated height of the next chunk.
// With left: 1, right: 1 it’s effectively a no-op; you’d change it if one side’s content “counts” differently for fitting. 
//   */
  var CONTENT_HEIGHT_SCALING = {
    base: 1,
    left: 1,
    right: 1,
  };

  /**
   * Right philosopher .line box: CSS constants that must match note-pages.css
   * .right-philosopher .note-page__content .line (height + padding-bottom).
   * Used to derive getEstimatedLineHeightPx("right") so JS and CSS stay in sync.
   */
  var RIGHT_LINE_HEIGHT_REM = 3;
  var RIGHT_LINE_PADDING_BOTTOM_PX = 24;
  var RIGHT_LINE_PADDING_BOTTOM_EM = 1.5;
  var REM_PX = 16;

  /** Default text padding (percent) when paper is not in PAPER_CONFIG */
  var DEFAULT_PAPER_PADDING = { top: 17.5, right: 17.5, bottom: 17.5, left: 17.5 };

  var DEFAULT_PAPER_SCALE = 1;

  /** Shared runtime config for note heuristics (notePages, noteQueueManager). Single source of truth. */
  var NOTE_RUNTIME_CONFIG = global.EDANoteConfig || (global.EDANoteConfig = {});
  var LONG_NOTE_THRESHOLD = typeof NOTE_RUNTIME_CONFIG.LONG_NOTE_THRESHOLD === "number"
    ? NOTE_RUNTIME_CONFIG.LONG_NOTE_THRESHOLD
    : 350;
  NOTE_RUNTIME_CONFIG.LONG_NOTE_THRESHOLD = LONG_NOTE_THRESHOLD;

  function getLongNoteThreshold() {
    return LONG_NOTE_THRESHOLD;
  }

  /**
   * Short-note (1–3 word) text rotation: random angle applied to philosopher jots.
   * Easy to find and change. Override via EDANoteConfig (e.g. SINGLE_WORD_ROTATION_ANGLE_MIN).
   */
  var SINGLE_WORD_ROTATION_ANGLE_MIN = typeof NOTE_RUNTIME_CONFIG.SINGLE_WORD_ROTATION_ANGLE_MIN === "number"
    ? NOTE_RUNTIME_CONFIG.SINGLE_WORD_ROTATION_ANGLE_MIN
    : -6;
  var SINGLE_WORD_ROTATION_ANGLE_MAX = typeof NOTE_RUNTIME_CONFIG.SINGLE_WORD_ROTATION_ANGLE_MAX === "number"
    ? NOTE_RUNTIME_CONFIG.SINGLE_WORD_ROTATION_ANGLE_MAX
    : 6;
  var SHORT_NOTE_MAX_WORDS = typeof NOTE_RUNTIME_CONFIG.SHORT_NOTE_MAX_WORDS === "number"
    ? NOTE_RUNTIME_CONFIG.SHORT_NOTE_MAX_WORDS
    : 3;
  /** Max number of leading spaces to add to short notes (0..this value inclusive). Override via EDANoteConfig.SHORT_NOTE_LEADING_SPACES_MAX. */
  var SHORT_NOTE_LEADING_SPACES_MAX = typeof NOTE_RUNTIME_CONFIG.SHORT_NOTE_LEADING_SPACES_MAX === "number"
    ? NOTE_RUNTIME_CONFIG.SHORT_NOTE_LEADING_SPACES_MAX
    : 7;

  /**
   * If text is 1–SHORT_NOTE_MAX_WORDS words (by space count), return a random rotation in
   * [SINGLE_WORD_ROTATION_ANGLE_MIN, SINGLE_WORD_ROTATION_ANGLE_MAX] degrees; otherwise null.
   */
  function getShortNoteRotationDeg(text) {
    if (text == null || typeof text !== "string") return null;
    var trimmed = text.trim();
    if (!trimmed.length) return null;
    var spaceCount = (trimmed.match(/\s/g) || []).length;
    var wordCount = spaceCount + 1;
    if (wordCount > SHORT_NOTE_MAX_WORDS) return null;
    var min = SINGLE_WORD_ROTATION_ANGLE_MIN;
    var max = SINGLE_WORD_ROTATION_ANGLE_MAX;
    return min + Math.random() * (max - min);
  }

  /**
   * If text is a short note (1–SHORT_NOTE_MAX_WORDS words), return random 0..SHORT_NOTE_LEADING_SPACES_MAX
   * (number of spaces to prepend); otherwise return 0.
   */
  function getShortNoteLeadingSpacesCount(text) {
    if (text == null || typeof text !== "string") return 0;
    var trimmed = text.trim();
    if (!trimmed.length) return 0;
    var spaceCount = (trimmed.match(/\s/g) || []).length;
    var wordCount = spaceCount + 1;
    if (wordCount > SHORT_NOTE_MAX_WORDS) return 0;
    var maxSpaces = SHORT_NOTE_LEADING_SPACES_MAX >= 0 ? SHORT_NOTE_LEADING_SPACES_MAX : 0;
    return maxSpaces === 0 ? 0 : Math.floor(Math.random() * (maxSpaces + 1));
  }

  /**
   * Paper image path -> {
   *   textPadding %,
   *   scale,
   *   boundingXFrac,
   *   boundingYFrac
   * }.
   * Width/height are no longer used; NOTE_BASE_SIZE + scale + responsive scale control the canvas.
   */
  var PAPER_CONFIG = {};

  /**
   * Get paper padding (percent). If side is "left" and NOTE_FORMAT.left.paperPaddingRightOverride
   * is set, that value is used for right (so you can reduce the left philosopher's right margin).
   */
  function getPaperPadding(paperUrl, side) {
    var entry = PAPER_CONFIG[paperUrl];
    if (!entry || !entry.textPadding) return DEFAULT_PAPER_PADDING;
    var pad = {
      top: Number(entry.textPadding.top) != null ? Number(entry.textPadding.top) : DEFAULT_PAPER_PADDING.top,
      right: Number(entry.textPadding.right) != null ? Number(entry.textPadding.right) : DEFAULT_PAPER_PADDING.right,
      bottom: Number(entry.textPadding.bottom) != null ? Number(entry.textPadding.bottom) : DEFAULT_PAPER_PADDING.bottom,
      left: Number(entry.textPadding.left) != null ? Number(entry.textPadding.left) : DEFAULT_PAPER_PADDING.left,
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
    var scale = entry && typeof entry.scale === "number" ? entry.scale : DEFAULT_PAPER_SCALE;
    if (!scale || scale <= 0) scale = DEFAULT_PAPER_SCALE;
    var responsiveScale = getResponsiveNoteScale();
    return {
      width: Math.round(NOTE_BASE_SIZE.width * scale * responsiveScale),
      height: Math.round(NOTE_BASE_SIZE.height * scale * responsiveScale),
    };
  }

  function getWritableAreaSize(paperUrl, side) {
    var bounding = getPaperBoundingBox(paperUrl);
    var pad = getPaperPadding(paperUrl, side);
    var width = bounding.width * (1 - (pad.left + pad.right) / 100);
    var height = bounding.height * (1 - (pad.top + pad.bottom) / 100);
    return {
      width: width > 0 ? width : 0,
      height: height > 0 ? height : 0,
    };
  }

  /**
   * Logical bounding box for selection/placement. Fractions are of visual paper size and centered.
   */
  function getPaperBoundingBox(paperUrl) {
    var size = getPaperSize(paperUrl);
    var entry = PAPER_CONFIG[paperUrl] || {};
    var bx = typeof entry.boundingXFrac === "number" && entry.boundingXFrac > 0 ? entry.boundingXFrac : 1;
    var by = typeof entry.boundingYFrac === "number" && entry.boundingYFrac > 0 ? entry.boundingYFrac : 1;
    var boundingWidth = size.width * bx;
    var boundingHeight = size.height * by;
    var offsetX = (size.width - boundingWidth) / 2;
    var offsetY = (size.height - boundingHeight) / 2;
    return {
      width: boundingWidth,
      height: boundingHeight,
      offsetX: offsetX,
      offsetY: offsetY,
    };
  }

  /**
   * Content box geometry inside the paper bounding box: position and size of the writable area.
   * Single source for positioning/sizing .note-page__content. Caller applies to DOM.
   * @param {{ width: number, height: number, offsetX: number, offsetY: number }} bounding
   * @param {{ top: number, right: number, bottom: number, left: number }} padding - percent 0..100
   * @returns {{ contentTop: number, contentLeft: number, writingAreaWidth: number, writingAreaHeight: number }}
   */
  function getContentBoxGeometry(bounding, padding) {
    var topInset = bounding.height * (padding.top / 100);
    var bottomInset = bounding.height * (padding.bottom / 100);
    var leftInset = bounding.width * (padding.left / 100);
    var rightInset = bounding.width * (padding.right / 100);
    var writingAreaWidth = bounding.width - leftInset - rightInset;
    var writingAreaHeight = bounding.height - topInset - bottomInset;
    if (writingAreaWidth < 0) writingAreaWidth = 0;
    if (writingAreaHeight < 0) writingAreaHeight = 0;
    return {
      contentTop: bounding.offsetY + topInset,
      contentLeft: bounding.offsetX + leftInset,
      writingAreaWidth: writingAreaWidth,
      writingAreaHeight: writingAreaHeight,
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
    // Legacy helper: width/height from paper-config.json are no longer used
    // for sizing. Keep returning 1 so any stray calls behave as a no-op.
    return 1;
  }

  /**
   * Load data/paper-config.json and merge into PAPER_CONFIG.
   * Call once at startup; notes created after it resolves use the JSON values.
   *
   * Each paper entry may include a "type" field used for pooling:
   *   - "small"  -> pooled as "small"
   *   - "medium" or "full" (or missing/unknown) -> pooled as "medium_full".
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

          // Prefer new "text-padding" field; fall back to legacy "padding" for backward compatibility.
          var paddingSource = raw["text-padding"] || raw.padding;
          var textPadding = paddingSource && typeof paddingSource === "object"
            ? {
                top: Number(paddingSource.top) != null ? Number(paddingSource.top) : DEFAULT_PAPER_PADDING.top,
                right: Number(paddingSource.right) != null ? Number(paddingSource.right) : DEFAULT_PAPER_PADDING.right,
                bottom: Number(paddingSource.bottom) != null ? Number(paddingSource.bottom) : DEFAULT_PAPER_PADDING.bottom,
                left: Number(paddingSource.left) != null ? Number(paddingSource.left) : DEFAULT_PAPER_PADDING.left,
              }
            : (existing && existing.textPadding) || DEFAULT_PAPER_PADDING;

          var scale = sanitizeScale(raw.scale, existing && existing.scale);

          var bx = typeof raw.bounding_x_frac === "number" ? raw.bounding_x_frac : (existing && typeof existing.boundingXFrac === "number" ? existing.boundingXFrac : 1);
          var by = typeof raw.bounding_y_frac === "number" ? raw.bounding_y_frac : (existing && typeof existing.boundingYFrac === "number" ? existing.boundingYFrac : 1);
          if (!(bx > 0)) bx = 1;
          if (!(by > 0)) by = 1;

          var rawType = typeof raw.type === "string" ? raw.type.toLowerCase() : (existing && existing.type) || null;
          var normalizedType;
          if (rawType === "small") normalizedType = "small";
          else if (rawType === "medium" || rawType === "full") normalizedType = rawType;
          else normalizedType = "full";
          // Pooling group used by allocator: "small" vs "medium_full".
          var typeGroup = normalizedType === "small" ? "small" : "medium_full";

          PAPER_CONFIG[key] = {
            textPadding: textPadding,
            scale: scale,
            boundingXFrac: bx,
            boundingYFrac: by,
            type: normalizedType,
            typeGroup: typeGroup,
          };
        }
        return PAPER_CONFIG;
      })
      .catch(function (err) {
        console.warn("[NoteFormatConfig] Could not load data/paper-config.json:", err.message);
        return PAPER_CONFIG;
      });
  }

  function getPaperType(paperUrl) {
    var entry = PAPER_CONFIG[paperUrl];
    return entry && entry.type ? entry.type : null;
  }

  function getPaperTypeGroup(paperUrl) {
    var entry = PAPER_CONFIG[paperUrl];
    if (!entry) return "medium_full";
    return entry.typeGroup || (entry.type === "small" ? "small" : "medium_full");
  }

  function getPaperImagesByTypeGroup(typeGroup) {
    var group = typeGroup === "small" ? "small" : "medium_full";
    var all = getPaperImages();
    return all.filter(function (paperUrl) {
      return getPaperTypeGroup(paperUrl) === group;
    });
  }

  /** Fallback display values when philosopherDisplay.config.js is not loaded (e.g. notedebug without that script). */
  var NOTE_FORMAT_DISPLAY_FALLBACK = {
    left: { fontSize: "1.05rem", color: "#202024", opacity: 0.98, fontWeight: "normal", fontFamily: '"Annie Use Your Telescope", cursive' },
    right: { fontSize: "1.12rem", color: "#284283", opacity: 0.93, fontWeight: "normal", fontFamily: '"Homemade Apple", cursive' },
  };

  /**
   * Merged format: layout (lineHeight, padding) from NOTE_FORMAT plus display (fontSize, color,
   * opacity, fontWeight, fontFamily) from philosopherDisplay.config.js when loaded.
   */
  function getNoteFormat(side) {
    var base = NOTE_FORMAT[side] || NOTE_FORMAT.left;
    var format = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) format[k] = base[k];
    var displayConfig = global.EDAPhilosopherDisplayConfig;
    if (displayConfig && typeof displayConfig.getPhilosopherBaseStyle === "function") {
      var display = displayConfig.getPhilosopherBaseStyle(side);
      if (display) {
        if (display.fontSize != null) format.fontSize = display.fontSize;
        if (display.color != null) format.color = display.color;
        if (display.opacity != null) format.opacity = display.opacity;
        if (display.fontWeight != null) format.fontWeight = display.fontWeight;
        if (display.fontFamily != null) format.fontFamily = display.fontFamily;
      }
    } else {
      var fallback = NOTE_FORMAT_DISPLAY_FALLBACK[side] || NOTE_FORMAT_DISPLAY_FALLBACK.left;
      if (fallback.fontSize != null) format.fontSize = fallback.fontSize;
      if (fallback.color != null) format.color = fallback.color;
      if (fallback.opacity != null) format.opacity = fallback.opacity;
      if (fallback.fontWeight != null) format.fontWeight = fallback.fontWeight;
      if (fallback.fontFamily != null) format.fontFamily = fallback.fontFamily;
    }
    return format;
  }

  function getContentHeightScale(side) {
    var s = CONTENT_HEIGHT_SCALING;
    return s.base * (side === "right" ? s.right : s.left);
  }

  /**
   * Per-line height (px) for height estimation. Single source: derived from getNoteFormat (fontSize from philosopherDisplay) and (for right) CSS .line constants.
   * Right: must match note-pages.css .right-philosopher .note-page__content .line (height 3rem + padding-bottom calc(24px + 1.5em)) so need_new_note and capacity stay correct. If long text overflows or short text gets unnecessary new notes, verify the computed height of a .line element matches this value (e.g. in dev: getComputedStyle(lineEl).height and lineEl.offsetHeight).
   * Left: fontSize × lineHeight from merged format.
   * estimateCharsPerLineForPaper: should reflect actual wrap at that paper's writable width; if estimates are off, compare with a measured line at getWritableAreaSize(paperUrl, side).width.
   */
  function getEstimatedLineHeightPx(side) {
    var format = getNoteFormat(side) || {};
    var fontSizePx = parseFontSizePx(format.fontSize);
    if (side === "right") {
      return RIGHT_LINE_HEIGHT_REM * REM_PX + RIGHT_LINE_PADDING_BOTTOM_PX + RIGHT_LINE_PADDING_BOTTOM_EM * fontSizePx;
    }
    var lineHeight = typeof format.lineHeight === "number" ? format.lineHeight : parseFloat(format.lineHeight);
    if (!lineHeight || !isFinite(lineHeight)) lineHeight = 1.4;
    var computed = fontSizePx * lineHeight;
    return computed > 0 ? computed : 40;
  }

  /**
   * Reference content width (px) for the default chars-per-line estimate (notePages.js).
   * Kept at 286px to match legacy behavior.
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
    var propKeys = ["lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "opacity", "color", "fontSize", "fontFamily", "fontWeight"];
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
    var bands = getResponsiveBands();
    for (var i = 0; i < bands.length; i++) {
      var band = bands[i];
      var minOk = typeof band.min === "number" ? width >= band.min : true;
      var maxOk = typeof band.max === "number" && isFinite(band.max) ? width <= band.max : true;
      if (minOk && maxOk) {
        return { mode: band.mode, noteScale: band.noteScale, fontScale: band.fontScale };
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
    var scaleStr = String(responsiveState.noteScale);
    var fontScaleStr = String(responsiveState.fontScale);
    if (typeof document !== "undefined" && document.documentElement) {
      var root = document.documentElement;
      root.style.setProperty("--note-responsive-scale", scaleStr);
      root.style.setProperty("--note-responsive-font-scale", fontScaleStr);
      var leftEl = document.getElementById("left-philosopher");
      var rightEl = document.getElementById("right-philosopher");
      if (leftEl) {
        leftEl.style.setProperty("--note-responsive-scale", scaleStr);
        leftEl.style.setProperty("--note-responsive-font-scale", fontScaleStr);
      }
      if (rightEl) {
        rightEl.style.setProperty("--note-responsive-scale", scaleStr);
        rightEl.style.setProperty("--note-responsive-font-scale", fontScaleStr);
      }
      var mobileNotes = document.getElementById("mobile-shared-notes");
      if (mobileNotes) {
        mobileNotes.style.setProperty("--note-responsive-scale", scaleStr);
        mobileNotes.style.setProperty("--note-responsive-font-scale", fontScaleStr);
      }
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

  /** Promise that resolves when paper config has been loaded. Use before first note enqueue. */
  var paperConfigReady = null;

  function whenPaperConfigLoaded() {
    if (paperConfigReady) return paperConfigReady;
    paperConfigReady = loadPaperConfigJson();
    return paperConfigReady;
  }

  global.EDANoteFormatConfig = {
    NOTE_FORMAT: NOTE_FORMAT,
    CONTENT_HEIGHT_SCALING: CONTENT_HEIGHT_SCALING,
    PAPER_CONFIG: PAPER_CONFIG,
    getPaperPadding: getPaperPadding,
    getPaperSize: getPaperSize,
    getWritableAreaSize: getWritableAreaSize,
    getPaperImages: getPaperImages,
    getPaperType: getPaperType,
    getPaperTypeGroup: getPaperTypeGroup,
    getPaperImagesByTypeGroup: getPaperImagesByTypeGroup,
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
    whenPaperConfigLoaded: whenPaperConfigLoaded,
    getLongNoteThreshold: getLongNoteThreshold,
    SINGLE_WORD_ROTATION_ANGLE_MIN: SINGLE_WORD_ROTATION_ANGLE_MIN,
    SINGLE_WORD_ROTATION_ANGLE_MAX: SINGLE_WORD_ROTATION_ANGLE_MAX,
    SHORT_NOTE_MAX_WORDS: SHORT_NOTE_MAX_WORDS,
    SHORT_NOTE_LEADING_SPACES_MAX: SHORT_NOTE_LEADING_SPACES_MAX,
    getShortNoteRotationDeg: getShortNoteRotationDeg,
    getShortNoteLeadingSpacesCount: getShortNoteLeadingSpacesCount,
    applyNoteFormatToPanels: applyNoteFormatToPanels,
    getPaperBoundingBox: getPaperBoundingBox,
    getContentBoxGeometry: getContentBoxGeometry,
  };

  if (typeof window !== "undefined") {
    whenPaperConfigLoaded();
    applyResponsiveViewportScales();
    window.addEventListener("resize", handleViewportResize);
  }
})(typeof window !== "undefined" ? window : this);
