/**
 * Pure layout and height-estimation logic for philosopher notes.
 * No DOM mutation, no note state. Depends on NoteFormatConfig.
 */
(function (global) {
  "use strict";

  var cfg = global.NoteFormatConfig;
  var getPaperPadding = cfg ? cfg.getPaperPadding : function () { return { top: 17.5, right: 17.5, bottom: 17.5, left: 17.5 }; };
  var getPaperSize = cfg ? cfg.getPaperSize : function () { return { width: 440, height: 560 }; };
  var FALLBACK_LINE_HEIGHT_PX = (cfg && cfg.ESTIMATE_LINE_HEIGHT_PX) ? cfg.ESTIMATE_LINE_HEIGHT_PX : { left: 28, right: 52 };
  var getEstimatedLineHeightPx = (cfg && cfg.getEstimatedLineHeightPx)
    ? cfg.getEstimatedLineHeightPx
    : function (side) {
        var fallback = FALLBACK_LINE_HEIGHT_PX || {};
        return fallback[side] || fallback.left || 32;
      };
  var getEstimateCharsPerLine = (cfg && cfg.getEstimateCharsPerLine) ? cfg.getEstimateCharsPerLine : null;
  var getEstimateCharsPerLineForPaper = (cfg && typeof cfg.estimateCharsPerLineForPaper === "function") ? cfg.estimateCharsPerLineForPaper : null;

  var ROTATION_MIN_DEG = -12;
  var ROTATION_MAX_DEG = 15;
  var ESTIMATE_CHARS_PER_LINE_FALLBACK = 80;

  /** Padding (px) below current text box when deciding if next chunk fits on same note. */
  var NOTE_BOX_PADDING_PX = 16;

  /** First note at top; each subsequent note this many % of region height lower. */
  var NOTE_STACK_OFFSET_PCT = 10;
  /** Random offset per note: +/- this many % of region height. */
  var NOTE_STACK_JITTER_PCT = 5;

  /** Class name of the debug overlay; skip it when finding the last real text chunk for placement. */
  var DEBUG_TEXT_BOX_CLASS = "note-page__debug-text-box";

  /**
   * Axis-aligned bounding box of the note rectangle (width x height)
   * rotated by rotationDeg around top-left (0,0).
   */
  function rotatedNoteAABB(rotationDeg, width, height) {
    var rad = (rotationDeg * Math.PI) / 180;
    var c = Math.cos(rad);
    var s = Math.sin(rad);
    var w = width;
    var h = height;
    var x0 = 0, y0 = 0;
    var x1 = w * c, y1 = w * s;
    var x2 = w * c - h * s, y2 = w * s + h * c;
    var x3 = -h * s, y3 = h * c;
    var minX = Math.min(x0, x1, x2, x3);
    var maxX = Math.max(x0, x1, x2, x3);
    var minY = Math.min(y0, y1, y2, y3);
    var maxY = Math.max(y0, y1, y2, y3);
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Position for a new note: first at top, then each subsequent note NOTE_STACK_OFFSET_PCT % lower +/- NOTE_STACK_JITTER_PCT %.
   * AABB is kept inside the region.
   */
  function stackedPositionInRegion(region, side, rotationDeg, noteWidth, noteHeight, noteIndex) {
    var w = region.clientWidth;
    var h = region.clientHeight;
    var aabb = rotatedNoteAABB(rotationDeg, noteWidth, noteHeight);
    var topMin = Math.max(0, -aabb.minY);
    var topMax = Math.min(h, h - aabb.maxY);

    var offsetPct = NOTE_STACK_OFFSET_PCT / 100;
    var jitterPct = NOTE_STACK_JITTER_PCT / 100;
    var baseTop = noteIndex * offsetPct * h;
    var jitter = (Math.random() * 2 - 1) * jitterPct * h;
    var top = Math.max(topMin, Math.min(topMax, Math.round(baseTop + jitter)));

    if (side === "left") {
      var leftMin = Math.max(0, -aabb.minX);
      var leftMax = Math.min(w, w - aabb.maxX);
      var leftRange = Math.max(0, Math.floor(leftMax - leftMin));
      var left = leftRange > 0 ? leftMin + Math.floor(Math.random() * (leftRange + 1)) : leftMin;
      left = Math.max(leftMin, Math.min(left, leftMax));
      return { left: left, right: undefined, top: top };
    }
    var rightMin = Math.max(0, aabb.maxX - noteWidth);
    var rightMax = Math.min(w, w - noteWidth + aabb.minX);
    var rightRange = Math.max(0, Math.floor(rightMax - rightMin));
    var right = rightRange > 0 ? rightMin + Math.floor(Math.random() * (rightRange + 1)) : rightMin;
    right = Math.max(rightMin, Math.min(right, rightMax));
    return { left: undefined, right: right, top: top };
  }

  /**
   * Estimated height (px) the next chunk will need.
   * @param {string} text - Text to measure
   * @param {string} side - "left" or "right"
   * @param {string} [paperUrl] - Optional. When provided, use this paper's chars-per-line so the estimate is correct for that note.
   */
  function estimateHeightForText(text, side, paperUrl) {
    if (!text || !text.length) return 0;
    var lineHeight = getEstimatedLineHeightPx(side);
    var charsPerLine;
    if (paperUrl && getEstimateCharsPerLineForPaper) {
      charsPerLine = getEstimateCharsPerLineForPaper(paperUrl, side);
    }
    if (charsPerLine == null || charsPerLine <= 0) {
      charsPerLine = getEstimateCharsPerLine ? getEstimateCharsPerLine(side) : ESTIMATE_CHARS_PER_LINE_FALLBACK;
    }
    if (charsPerLine == null || charsPerLine <= 0) charsPerLine = ESTIMATE_CHARS_PER_LINE_FALLBACK;
    var lines = Math.max(1, Math.ceil(text.length / charsPerLine));
    var estimatedPx = lines * lineHeight;
    // #region agent log (local debug only; no external network by default)
    if (typeof document !== "undefined" && document.body && document.body.dataset && document.body.dataset.devMode === "true") {
      var payload = {
        sessionId: "532d40",
        runId: "fit-debug",
        location: "noteLayout.js:estimateHeightForText",
        message: "height estimate",
        data: {
          side: side,
          textLen: text.length,
          charsPerLine: charsPerLine,
          lineHeightPx: lineHeight,
          lines: lines,
          estimatedPx: estimatedPx,
          usedFallbackCharsPerLine: !getEstimateCharsPerLine || getEstimateCharsPerLine(side) == null,
        },
        timestamp: Date.now(),
      };
      if (typeof console !== "undefined" && console.debug) {
        console.debug("[noteLayout] estimateHeightForText", payload);
      }
      // If a custom ingest hook is provided, call it instead of hitting a hard-coded localhost endpoint.
      if (typeof global.EDANoteDebugIngest === "function") {
        try {
          global.EDANoteDebugIngest(payload);
        } catch (e) {}
      }
    }
    // #endregion
    return estimatedPx;
  }

  /**
   * Offset of elt from ancestor by walking offsetParent chain. Uses the same layout coordinate
   * system as position:absolute inside ancestor, so it stays correct when an outer wrapper is rotated.
   */
  function getOffsetRelativeTo(elt, ancestor) {
    var top = 0, left = 0;
    var node = elt;
    while (node && node !== ancestor) {
      top += node.offsetTop;
      left += node.offsetLeft;
      node = node.offsetParent;
    }
    return node === ancestor ? { top: top, left: left } : null;
  }

  /**
   * True bounding box of the current character text (last chunk) in content coordinates.
   * For the right philosopher: union of .line span rects in layout (offset) coordinates so the
   * debug box and spaceAfterBox stay correct when the note wrapper is rotated.
   * @returns {{ top: number, left: number, width: number, height: number } | null}
   */
  function getCurrentTextBounds(contentEl, side) {
    var last = contentEl.lastElementChild;
    while (last && last.classList && last.classList.contains(DEBUG_TEXT_BOX_CLASS)) {
      last = last.previousElementSibling;
    }
    if (!last) return null;
    var topPx = last.offsetTop;
    var leftPx = last.offsetLeft;
    var widthPx = last.offsetWidth;
    var heightPx = last.offsetHeight;
    if (side === "right" && last.classList && last.classList.contains("container")) {
      var spans = last.querySelectorAll(".line span");
      if (spans.length > 0) {
        var minTop = Infinity, minLeft = Infinity, maxBottom = -Infinity, maxRight = -Infinity;
        for (var si = 0; si < spans.length; si++) {
          var span = spans[si];
          if (span.offsetWidth > 0 || span.offsetHeight > 0) {
            var off = getOffsetRelativeTo(span, contentEl);
            if (off) {
              var sTop = off.top;
              var sLeft = off.left;
              var sBottom = sTop + span.offsetHeight;
              var sRight = sLeft + span.offsetWidth;
              if (sLeft < minLeft) minLeft = sLeft;
              if (sTop < minTop) minTop = sTop;
              if (sRight > maxRight) maxRight = sRight;
              if (sBottom > maxBottom) maxBottom = sBottom;
            }
          }
        }
        if (minTop !== Infinity) {
          var trimBottomPx = 24;
          var boxHeight = maxBottom - minTop;
          if (boxHeight > trimBottomPx) boxHeight -= trimBottomPx;
          topPx = minTop;
          leftPx = minLeft;
          widthPx = maxRight - minLeft;
          heightPx = boxHeight;
        }
      }
    }
    return { top: topPx, left: leftPx, width: widthPx, height: heightPx };
  }

  function getPaperWritingAreaHeight(paperUrl, side) {
    if (cfg && typeof cfg.getWritableAreaSize === "function") {
      var writable = cfg.getWritableAreaSize(paperUrl, side);
      if (writable && typeof writable.height === "number") {
        return writable.height;
      }
    }
    var size = getPaperSize(paperUrl);
    var padding = getPaperPadding(paperUrl, side);
    return size.height * (1 - (padding.top + padding.bottom) / 100);
  }

  function randomRotationDeg() {
    return ROTATION_MIN_DEG + Math.random() * (ROTATION_MAX_DEG - ROTATION_MIN_DEG);
  }

  global.NoteLayout = {
    rotatedNoteAABB: rotatedNoteAABB,
    stackedPositionInRegion: stackedPositionInRegion,
    estimateHeightForText: estimateHeightForText,
    getCurrentTextBounds: getCurrentTextBounds,
    getPaperWritingAreaHeight: getPaperWritingAreaHeight,
    randomRotationDeg: randomRotationDeg,
    NOTE_BOX_PADDING_PX: NOTE_BOX_PADDING_PX,
    NOTE_STACK_OFFSET_PCT: NOTE_STACK_OFFSET_PCT,
    NOTE_STACK_JITTER_PCT: NOTE_STACK_JITTER_PCT,
    DEBUG_TEXT_BOX_CLASS: DEBUG_TEXT_BOX_CLASS,
  };
})(typeof window !== "undefined" ? window : this);
