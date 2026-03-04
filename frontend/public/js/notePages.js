(function (global) {
  "use strict";

  /* DEBUG: Set to true only in dev to show bounding box and label on each note. Remove this feature before release. */
  var NOTE_DEBUG = true;

  var cfg = global.NoteFormatConfig;
  var getPaperPadding = cfg ? cfg.getPaperPadding : function () { return { top: 17.5, right: 17.5, bottom: 17.5, left: 17.5 }; };
  var getPaperSize = cfg ? cfg.getPaperSize : function () { return { width: 440, height: 560 }; };
  var getNoteFormat = cfg ? cfg.getNoteFormat : function () { return {}; };
  var getContentHeightScale = cfg ? cfg.getContentHeightScale : function () { return 1; };
  var ESTIMATE_LINE_HEIGHT_PX = (cfg && cfg.ESTIMATE_LINE_HEIGHT_PX) ? cfg.ESTIMATE_LINE_HEIGHT_PX : { left: 28, right: 52 };

  var ROTATION_MIN_DEG = -18;
  var ROTATION_MAX_DEG = 15;
  var getEstimateCharsPerLine = (cfg && cfg.getEstimateCharsPerLine) ? cfg.getEstimateCharsPerLine : null;
  var ESTIMATE_CHARS_PER_LINE_FALLBACK = 80;

  /** Padding (px) below current text box when deciding if next chunk fits on same note. Increase to require more gap before new note. */
  var NOTE_BOX_PADDING_PX = 16;

  /** First note at top; each subsequent note this many % of region height lower (e.g. 10 = 10%). */
  var NOTE_STACK_OFFSET_PCT = 10;
  /** Random offset per note: +/- this many % of region height (e.g. 5 = ±5%). */
  var NOTE_STACK_JITTER_PCT = 5;

  function getPaperImages() {
    return (cfg && cfg.getPaperImages) ? cfg.getPaperImages() : ["imgs/paper3.png", "imgs/paper4.webp"];
  }

  // var REGION_PADDING_PX = 200;

  var noteZIndex = 1;
  var state = {
    left: { currentNote: null, contentElement: null, usedHeight: 0, writingAreaHeight: 0 },
    right: { currentNote: null, contentElement: null, usedHeight: 0, writingAreaHeight: 0 },
  };

  function getPanel(side) {
    var id = side === "right" ? "right-philosopher-content" : "left-philosopher-content";
    return document.getElementById(id);
  }

  function getOrCreateRegion(side) {
    var panel = getPanel(side);
    if (!panel) return null;
    var region = panel.querySelector(".notes-region");
    if (region) return region;
    region = document.createElement("div");
    region.className = "notes-region notes-region--" + side;
    panel.appendChild(region);
    return region;
  }

  function randomPaperUrl() {
    var list = getPaperImages();
    return list[Math.floor(Math.random() * list.length)];
  }

  function randomRotationDeg() {
    return ROTATION_MIN_DEG + Math.random() * (ROTATION_MAX_DEG - ROTATION_MIN_DEG);
  }

  /**
   * Estimated height (px) the next chunk will need. Used with getCurrentTextBounds to decide if we need a new note.
   * ESTIMATE_LINE_HEIGHT_PX (from NoteFormatConfig) must match each philosopher's real line height or we underestimate
   * and add text that overflows/overlaps (especially right philosopher).
   */
  function estimateHeightForText(text, side) {
    if (!text || !text.length) return 0;
    var lineHeight = ESTIMATE_LINE_HEIGHT_PX[side] || ESTIMATE_LINE_HEIGHT_PX.left;
    var charsPerLine = getEstimateCharsPerLine ? getEstimateCharsPerLine(side) : ESTIMATE_CHARS_PER_LINE_FALLBACK;
    var lines = Math.max(1, Math.ceil(text.length / charsPerLine));
    return lines * lineHeight;
  }

  /** Class name of the debug overlay; skip it when finding the last real text chunk for placement. */
  var DEBUG_TEXT_BOX_CLASS = "note-page__debug-text-box";

  /**
   * True bounding box of the current character text (last chunk) in content coordinates.
   * For the right philosopher: union of .line span rects measured relative to the container, then + container.offsetTop/Left
   * so the box is not shifted by the container's margin or content scroll. Skips debug overlay when finding last chunk.
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
        var containerRect = last.getBoundingClientRect();
        var minTop = Infinity, minLeft = Infinity, maxBottom = -Infinity, maxRight = -Infinity;
        for (var si = 0; si < spans.length; si++) {
          var r = spans[si].getBoundingClientRect();
          if (r.width > 0 || r.height > 0) {
            var relLeft = r.left - containerRect.left;
            var relTop = r.top - containerRect.top;
            var relRight = r.right - containerRect.left;
            var relBottom = r.bottom - containerRect.top;
            if (relLeft < minLeft) minLeft = relLeft;
            if (relTop < minTop) minTop = relTop;
            if (relRight > maxRight) maxRight = relRight;
            if (relBottom > maxBottom) maxBottom = relBottom;
          }
        }
        if (minTop !== Infinity) {
          var trimBottomPx = 24;
          var boxHeight = maxBottom - minTop;
          if (boxHeight > trimBottomPx) boxHeight -= trimBottomPx;
          topPx = last.offsetTop + minTop;
          leftPx = last.offsetLeft + minLeft;
          widthPx = maxRight - minLeft;
          heightPx = boxHeight;
        }
      }
    }
    return { top: topPx, left: leftPx, width: widthPx, height: heightPx };
  }

  function getPaperWritingAreaHeight(paperUrl, side) {
    var size = getPaperSize(paperUrl);
    var padding = getPaperPadding(paperUrl, side);
    return size.height * (1 - (padding.top + padding.bottom) / 100);
  }

  var LOG_PREFIX = "[note-pages]";

  /**
   * Decide if the next text chunk needs a new note using the actual current text bounding box + padding.
   * @param {string} side - "left" | "right"
   * @param {string} nextText - next chunk to write
   * @returns {{ needNew: boolean, preferLargerPaper?: boolean }}
   */
  function need_new_note(side, nextText) {
    var s = state[side];
    var defaultLineHeight = ESTIMATE_LINE_HEIGHT_PX[side] || ESTIMATE_LINE_HEIGHT_PX.left;
    var estimatedNext = nextText != null
      ? estimateHeightForText(String(nextText), side)
      : defaultLineHeight * 2;
    console.log(LOG_PREFIX, "need_new_note(", side, ", nextText length:", nextText != null ? String(nextText).length : null, ", estimatedNext px:", estimatedNext, ")");

    if (!s.currentNote || !s.contentElement) {
      var papers0 = getPaperImages();
      var minArea0 = Infinity;
      for (var pk = 0; pk < papers0.length; pk++) {
        var h0 = getPaperWritingAreaHeight(papers0[pk], side);
        if (h0 < minArea0) minArea0 = h0;
      }
      var preferLarger = papers0.length > 1 && estimatedNext > (minArea0 !== Infinity ? minArea0 : 0);
      console.log(LOG_PREFIX, "  -> need new: no current note", { preferLargerPaper: preferLarger });
      return { needNew: true, preferLargerPaper: preferLarger };
    }
    var contentEl = s.contentElement;
    if (!contentEl.isConnected) {
      console.log(LOG_PREFIX, "  -> need new: contentElement not in DOM");
      return { needNew: true, preferLargerPaper: false };
    }
    var writingAreaHeight = contentEl.clientHeight;
    if (!writingAreaHeight && s.writingAreaHeight > 0) writingAreaHeight = s.writingAreaHeight;
    if (!writingAreaHeight) {
      console.log(LOG_PREFIX, "  -> need new: writingAreaHeight is 0");
      return { needNew: true, preferLargerPaper: false };
    }

    var bounds = getCurrentTextBounds(contentEl, side);
    var currentBottom = bounds ? bounds.top + bounds.height : 0;
    var paddingPx = (global.notePages && global.notePages.NOTE_BOX_PADDING_PX != null) ? global.notePages.NOTE_BOX_PADDING_PX : NOTE_BOX_PADDING_PX;
    var spaceAfterBox = currentBottom + paddingPx;
    var fitsCurrent = spaceAfterBox + estimatedNext <= writingAreaHeight;

    console.log(LOG_PREFIX, "  writingAreaHeight:", writingAreaHeight, "currentBottom:", currentBottom, "padding:", paddingPx, "spaceAfterBox:", spaceAfterBox, "estimatedNext:", estimatedNext, "fits:", fitsCurrent);

    if (fitsCurrent) return { needNew: false };

    var papers = getPaperImages();
    var minArea = Infinity;
    var maxArea = 0;
    for (var pj = 0; pj < papers.length; pj++) {
      var ha = getPaperWritingAreaHeight(papers[pj], side);
      if (ha < minArea) minArea = ha;
      if (ha > maxArea) maxArea = ha;
    }
    var preferLargerPaper = papers.length > 1 && estimatedNext > minArea;

    console.log(LOG_PREFIX, "  -> need new", preferLargerPaper ? "(prefer larger paper)" : "");
    return { needNew: true, preferLargerPaper: preferLargerPaper };
  }

  /**
   * Axis-aligned bounding box of the note rectangle (width x height)
   * rotated by rotationDeg around top-left (0,0). Used so we never place a note
   * such that its rectangular bounding box overflows the region.
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

  function write_new_note(side, options) {
    options = options || {};
    var region = getOrCreateRegion(side);
    if (!region) return null;

    var paperUrl;
    if (options.preferLargerPaper) {
      var papers = getPaperImages();
      var bestUrl = papers[0];
      var bestArea = 0;
      for (var pi = 0; pi < papers.length; pi++) {
        var area = getPaperWritingAreaHeight(papers[pi], side);
        if (area > bestArea) {
          bestArea = area;
          bestUrl = papers[pi];
        }
      }
      paperUrl = bestUrl;
    } else {
      paperUrl = randomPaperUrl();
    }
    var rotationDeg = randomRotationDeg();
    var size = getPaperSize(paperUrl);
    var noteWidth = size.width;
    var noteHeight = size.height;
    var noteIndex = region.querySelectorAll(".note-page").length;
    var pos = stackedPositionInRegion(region, side, rotationDeg, noteWidth, noteHeight, noteIndex);

    var wrapper = document.createElement("div");
    wrapper.className = "note-page note-page--" + side;
    noteZIndex += 1;
    wrapper.style.zIndex = String(noteZIndex);
    wrapper.style.transformOrigin = "top left";
    wrapper.style.transform = "rotate(" + rotationDeg + "deg)";
    if (pos.left != null) wrapper.style.left = pos.left + "px";
    if (pos.right != null) wrapper.style.right = pos.right + "px";
    wrapper.style.top = pos.top + "px";
    wrapper.setAttribute("role", "button");
    wrapper.setAttribute("tabindex", "0");
    wrapper.setAttribute("aria-label", "Bring note to front");
    wrapper.addEventListener("click", function () {
      noteZIndex += 1;
      wrapper.style.zIndex = String(noteZIndex);
      if (wrapper.parentNode === region) {
        region.appendChild(wrapper);
      }
    });

    var paper = document.createElement("div");
    paper.className = "note-page__paper";
    paper.style.backgroundImage = "url(" + paperUrl + ")";
    paper.style.width = noteWidth + "px";
    paper.style.height = noteHeight + "px";
    wrapper.appendChild(paper);

    var padding = getPaperPadding(paperUrl, side);
    var writingAreaHeight = noteHeight * (1 - (padding.top + padding.bottom) / 100);
    var writingAreaWidth = noteWidth * (1 - (padding.left + padding.right) / 100);

    var content = document.createElement("div");
    content.className = "note-page__content";
    content.setAttribute("data-side", side);
    content.style.top = padding.top + "%";
    content.style.right = padding.right + "%";
    content.style.bottom = padding.bottom + "%";
    content.style.left = padding.left + "%";
    content.style.height = writingAreaHeight + "px";
    content.style.width = writingAreaWidth + "px";
    applyNoteFormatStyles(content, side);
    paper.appendChild(content);

    /* Temporary dev-only: draw bounding box and label on each note. Remove before release. */
    if (NOTE_DEBUG) {
      var debugBox = document.createElement("div");
      debugBox.className = "note-page__debug-box";
      debugBox.setAttribute("aria-hidden", "true");
      debugBox.style.cssText =
        "position:absolute;top:0;left:0;width:" + noteWidth + "px;height:" + noteHeight + "px;" +
        "border:2px solid #000;background:transparent;pointer-events:none;box-sizing:border-box;";
      var label = document.createElement("span");
      label.style.cssText = "position:absolute;top:2px;left:2px;background:#000;color:#fff;font-size:10px;padding:2px 4px;font-family:sans-serif;";
      label.textContent = String(noteZIndex);
      debugBox.appendChild(label);
      wrapper.appendChild(debugBox);
    }

    region.appendChild(wrapper);
    state[side] = {
      currentNote: wrapper,
      contentElement: content,
      usedHeight: 0,
      writingAreaHeight: writingAreaHeight,
    };
    console.log(LOG_PREFIX, "write_new_note(", side, ") created note, writingAreaHeight:", writingAreaHeight, "usedHeight: 0");

    return content;
  }

  /**
   * Apply philosopher-specific note format (line height, padding, opacity, color, etc.) from config
   * via CSS custom properties so note-pages.css can use var(--note-*).
   */
  function applyNoteFormatStyles(contentEl, side) {
    var format = getNoteFormat(side);
    if (!format) return;
    var vars = [
      ["lineHeight", format.lineHeight],
      ["paddingTop", format.paddingTop],
      ["paddingRight", format.paddingRight],
      ["paddingBottom", format.paddingBottom],
      ["paddingLeft", format.paddingLeft],
      ["opacity", format.opacity],
      ["color", format.color],
      ["fontSize", format.fontSize],
      ["fontFamily", format.fontFamily],
    ];
    for (var i = 0; i < vars.length; i++) {
      var key = vars[i][0];
      var val = vars[i][1];
      if (val != null) contentEl.style.setProperty("--note-" + key, val);
    }
  }

  /**
   * Actual height used by written content (sum of children heights), scaled by philosopher.
   * The content element has a fixed height (writing area); scrollHeight can equal that and overstate usage.
   */
  function getContentUsedHeight(contentEl) {
    var used = 0;
    for (var i = 0; i < contentEl.children.length; i++) {
      used += contentEl.children[i].offsetHeight;
    }
    var side = contentEl.getAttribute("data-side") || "left";
    var scale = getContentHeightScale(side);
    return used * scale;
  }

  function get_current_content_element(side) {
    var s = state[side];
    return (s && s.contentElement) || null;
  }

  function write_on_current_note(side, text, options) {
    var s = state[side];
    var contentEl = s && s.contentElement;
    if (!contentEl || typeof handwriter === "undefined" || !text) return Promise.resolve();

    options = options || {};
    var debugLabel = options.debugLabel;
    var debugQueueAtEnqueue = options.debugQueueAtEnqueue;

    if (side === "right") {
      var bounds = getCurrentTextBounds(contentEl, side);
      if (bounds) {
        var last = contentEl.lastElementChild;
        while (last && last.classList && last.classList.contains(DEBUG_TEXT_BOX_CLASS)) {
          last = last.previousElementSibling;
        }
        var paddingPx = (global.notePages && global.notePages.NOTE_BOX_PADDING_PX != null) ? global.notePages.NOTE_BOX_PADDING_PX : NOTE_BOX_PADDING_PX;
        var wantStartY = bounds.top + bounds.height + paddingPx;
        var naturalBottom = last ? last.offsetTop + last.offsetHeight : 0;
        options.startBelowMarginPx = wantStartY - naturalBottom;
      }
    }

    return handwriter.appendText(contentEl, text, options).then(function () {
      if (state[side] && state[side].contentElement === contentEl) {
        var prev = state[side].usedHeight;
        state[side].usedHeight = getContentUsedHeight(contentEl);
        console.log(LOG_PREFIX, "write_on_current_note(", side, ") done. contentUsedHeight:", state[side].usedHeight, "scrollHeight:", contentEl.scrollHeight, "usedHeight:", prev, "->", state[side].usedHeight);
        /* Temporary dev-only: draw bounding box around the text we just wrote. Remove before release. */
        if (NOTE_DEBUG) {
          contentEl.classList.add("note-page__content--debug-overflow");
          var existing = contentEl.querySelectorAll(".note-page__debug-text-box");
          for (var e = 0; e < existing.length; e++) existing[e].remove();
          var bounds = getCurrentTextBounds(contentEl, side);
          if (bounds) {
            var textBox = document.createElement("div");
            textBox.className = DEBUG_TEXT_BOX_CLASS;
            textBox.setAttribute("aria-hidden", "true");
            textBox.style.cssText =
              "position:absolute;border:1px solid #000;background:transparent;pointer-events:none;box-sizing:border-box;overflow:visible;";
            textBox.style.top = bounds.top + "px";
            textBox.style.left = bounds.left + "px";
            textBox.style.width = bounds.width + "px";
            textBox.style.height = bounds.height + "px";
            var labelParts = [];
            if (debugLabel) labelParts.push(debugLabel);
            if (debugQueueAtEnqueue != null) labelParts.push("q:" + debugQueueAtEnqueue);
            if (labelParts.length > 0) {
              var label = document.createElement("span");
              label.style.cssText = "position:absolute;top:-14px;left:0;background:#000;color:#fff;font-size:10px;padding:1px 4px;font-family:sans-serif;white-space:nowrap;";
              label.textContent = labelParts.join(" ");
              textBox.appendChild(label);
            }
            contentEl.appendChild(textBox);
          }
        }
      } else {
        console.log(LOG_PREFIX, "write_on_current_note(", side, ") done but state changed, did not update usedHeight");
      }
    });
  }

  global.notePages = {
    need_new_note: need_new_note,
    write_new_note: write_new_note,
    write_on_current_note: write_on_current_note,
    get_current_content_element: get_current_content_element,
    estimate_height: estimateHeightForText,
    NOTE_BOX_PADDING_PX: NOTE_BOX_PADDING_PX,
    NOTE_STACK_OFFSET_PCT: NOTE_STACK_OFFSET_PCT,
    NOTE_STACK_JITTER_PCT: NOTE_STACK_JITTER_PCT,
  };
})(typeof window !== "undefined" ? window : this);
