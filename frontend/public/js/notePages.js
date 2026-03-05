(function (global) {
  "use strict";

  /* DEBUG: Create bounding box + label on each note.
   * Visibility is controlled purely by CSS:
   *   - In dev:  body[data-dev-mode="true"] ...  -> visible
   *   - Non-dev: body:not([data-dev-mode="true"]) ...  -> hidden
   */
  var NOTE_DEBUG = true;

  var cfg = global.NoteFormatConfig;
  var getPaperPadding = cfg ? cfg.getPaperPadding : function () { return { top: 17.5, right: 17.5, bottom: 17.5, left: 17.5 }; };
  var getPaperSize = cfg ? cfg.getPaperSize : function () { return { width: 440, height: 560 }; };
  var getNoteFormat = cfg ? cfg.getNoteFormat : function () { return {}; };
  var getContentHeightScale = cfg ? cfg.getContentHeightScale : function () { return 1; };

  // Shared runtime config for note heuristics (also read by noteQueueManager).
  var NOTE_RUNTIME_CONFIG = global.EDANoteConfig || (global.EDANoteConfig = {});
  var LONG_NOTE_THRESHOLD = typeof NOTE_RUNTIME_CONFIG.LONG_NOTE_THRESHOLD === "number"
    ? NOTE_RUNTIME_CONFIG.LONG_NOTE_THRESHOLD
    : 350;
  NOTE_RUNTIME_CONFIG.LONG_NOTE_THRESHOLD = LONG_NOTE_THRESHOLD;

  var NoteLayout = global.NoteLayout;
  var NoteElement = global.NoteElement;

  // When viewport is large (desktop >1440px) and the chat has begun scrolling,
  // new notes can be positioned near the user's most recent message.
  // Base vertical offset from the last user entry (px).
  var DYNAMIC_ANCHOR_BASE_OFFSET_PX = 40;
  // Random jitter added to the base offset for each note (±px).
  var DYNAMIC_ANCHOR_JITTER_PX = 40;

  var state = {
    left: { currentNote: null, contentElement: null, usedHeight: 0, writingAreaHeight: 0 },
    right: { currentNote: null, contentElement: null, usedHeight: 0, writingAreaHeight: 0 },
  };

  var paperListFallbackWarned = false;

  function isLargeViewport() {
    if (typeof document === "undefined") return false;
    var body = document.body;
    return !!(body && body.dataset && body.dataset.viewport === "large");
  }

  function getLastUserMessageElement() {
    if (typeof document === "undefined") return null;
    var messages = document.getElementById("messages");
    if (!messages) return null;
    // Prefer the last explicit user chat bubble; fall back to any user block.
    var userMessages = messages.querySelectorAll(".message.user");
    if (userMessages.length > 0) return userMessages[userMessages.length - 1];
    var userBlocks = messages.querySelectorAll(".chat-user-block");
    if (userBlocks.length > 0) return userBlocks[userBlocks.length - 1];
    return null;
  }

  function chatHasStartedScrolling() {
    if (typeof document === "undefined") return false;
    // Treat "started scrolling" as: overall document taller than viewport.
    var docEl = document.documentElement;
    if (!docEl) return false;
    return docEl.scrollHeight > docEl.clientHeight + 1;
  }

  function randomJitterPx() {
    return (Math.random() * 2 - 1) * DYNAMIC_ANCHOR_JITTER_PX;
  }

  function getPaperImages() {
    if (cfg && typeof cfg.getPaperImages === "function") {
      var list = cfg.getPaperImages();
      if (Array.isArray(list) && list.length) return list;
    }
    if (!paperListFallbackWarned) {
      paperListFallbackWarned = true;
      console.warn("[notePages] Using fallback paper list; NoteFormatConfig may not be loaded.");
    }
    return ["imgs/paper4.webp"];
  }

  function getSharedMobilePanel() {
    if (typeof document === "undefined") return null;
    var body = document.body;
    if (!body || body.dataset.mobileNotesMode !== "shared") return null;
    return document.getElementById("mobile-shared-notes-content");
  }

  function getPanel(side) {
    var shared = getSharedMobilePanel();
    if (shared) return shared;
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

  function refreshNotesForSide(side) {
    var panel = getPanel(side);
    if (!panel) return;
    var region = panel.querySelector(".notes-region");
    if (!region) return;
    var wrappers = region.querySelectorAll(".note-page");
    if (!wrappers.length) return;
    var sideState = state[side];
    for (var i = 0; i < wrappers.length; i++) {
      var wrapper = wrappers[i];
      var paperUrl = wrapper.dataset.paperUrl;
      if (!paperUrl) continue;
      var sizing = applyPaperSizing(wrapper, side, paperUrl);
      if (!sizing) continue;
      if (sideState && sideState.currentNote === wrapper) {
        sideState.writingAreaHeight = sizing.writingAreaHeight || sideState.writingAreaHeight;
        if (sideState.contentElement && sideState.contentElement.isConnected) {
          sideState.usedHeight = getContentUsedHeight(sideState.contentElement);
        }
      }
    }
  }

  function refreshAllNotesDimensions() {
    refreshNotesForSide("left");
    refreshNotesForSide("right");
  }

  function handleResponsiveScaleUpdate() {
    refreshAllNotesDimensions();
    if (global.NoteCapacity && typeof global.NoteCapacity.invalidate === "function") {
      global.NoteCapacity.invalidate();
    }
  }

  function randomPaperUrl() {
    var list = getPaperImages();
    return list[Math.floor(Math.random() * list.length)];
  }

  function applyPaperSizing(wrapper, side, paperUrl, presetSize) {
    if (!wrapper || !paperUrl) return null;
    var paperEl = wrapper.querySelector(".note-page__paper");
    var contentEl = wrapper.querySelector(".note-page__content");
    if (!paperEl || !contentEl) return null;
    var size = presetSize || getPaperSize(paperUrl);
    var padding = getPaperPadding(paperUrl, side);
    var noteWidth = size.width;
    var noteHeight = size.height;
    paperEl.style.width = noteWidth + "px";
    paperEl.style.height = noteHeight + "px";
    contentEl.style.top = padding.top + "%";
    contentEl.style.right = padding.right + "%";
    contentEl.style.bottom = padding.bottom + "%";
    contentEl.style.left = padding.left + "%";
    var writingAreaHeight = noteHeight * (1 - (padding.top + padding.bottom) / 100);
    var writingAreaWidth = noteWidth * (1 - (padding.left + padding.right) / 100);
    contentEl.style.height = writingAreaHeight + "px";
    contentEl.style.width = writingAreaWidth + "px";

    if (NOTE_DEBUG) {
      // Visualize paper padding and computed writing area in dev mode only.
      var debugBox = paperEl.querySelector(".note-page__debug-padding-box");
      if (!debugBox) {
        debugBox = document.createElement("div");
        debugBox.className = "note-page__debug-padding-box";
        debugBox.setAttribute("aria-hidden", "true");
        paperEl.appendChild(debugBox);
      }

      var topPx = noteHeight * (padding.top / 100);
      var bottomPx = noteHeight * (padding.bottom / 100);
      var leftPx = noteWidth * (padding.left / 100);
      var rightPx = noteWidth * (padding.right / 100);
      var boxWidth = noteWidth - leftPx - rightPx;
      var boxHeight = noteHeight - topPx - bottomPx;

      debugBox.style.top = topPx + "px";
      debugBox.style.left = leftPx + "px";
      debugBox.style.width = boxWidth + "px";
      debugBox.style.height = boxHeight + "px";

      var label = debugBox.querySelector("span");
      if (!label) {
        label = document.createElement("span");
        debugBox.appendChild(label);
      }
      label.textContent =
        "pad T:" + padding.top + " R:" + padding.right +
        " B:" + padding.bottom + " L:" + padding.left +
        " | area " + Math.round(boxWidth) + "x" + Math.round(boxHeight);
    }

    return { noteWidth: noteWidth, noteHeight: noteHeight, writingAreaHeight: writingAreaHeight };
  }

  function clearStateFor(side) {
    state[side] = { currentNote: null, contentElement: null, usedHeight: 0, writingAreaHeight: 0 };
  }

  var LOG_PREFIX = "[note-pages]";

  /**
   * Decide if the next text chunk needs a new note using the actual current text bounding box + padding.
   */
  function need_new_note(side, nextText) {
    var s = state[side];
    var defaultLineHeight = (cfg && cfg.getEstimatedLineHeightPx) ? cfg.getEstimatedLineHeightPx(side) : 40;
    var estimatedNext = nextText != null
      ? NoteLayout.estimateHeightForText(String(nextText), side)
      : defaultLineHeight * 2;
    console.log(LOG_PREFIX, "need_new_note(", side, ", nextText length:", nextText != null ? String(nextText).length : null, ", estimatedNext px:", estimatedNext, ")");

    if (!s.currentNote || !s.contentElement) {
      var papers0 = getPaperImages();
      var minArea0 = Infinity;
      for (var pk = 0; pk < papers0.length; pk++) {
        var h0 = NoteLayout.getPaperWritingAreaHeight(papers0[pk], side);
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

    var bounds = NoteLayout.getCurrentTextBounds(contentEl, side);
    var baselineBottom = bounds ? bounds.top + bounds.height : 0;
    var usedHeight = (s && typeof s.usedHeight === "number") ? s.usedHeight : 0;
    if (!usedHeight && contentEl.children.length > 0) {
      usedHeight = getContentUsedHeight(contentEl);
    }
    var currentBottom = Math.max(baselineBottom, usedHeight);
    var paddingPx = NoteLayout.NOTE_BOX_PADDING_PX;
    var spaceAfterBox = currentBottom + paddingPx;
    var fitsCurrent = spaceAfterBox + estimatedNext <= writingAreaHeight;

    console.log(LOG_PREFIX, "  writingAreaHeight:", writingAreaHeight, "baselineBottom:", baselineBottom, "usedHeight:", usedHeight, "padding:", paddingPx, "spaceAfterBox:", spaceAfterBox, "estimatedNext:", estimatedNext, "fits:", fitsCurrent);
    var papers = getPaperImages();
    var minArea = Infinity;
    var maxArea = 0;
    for (var pj = 0; pj < papers.length; pj++) {
      var ha = NoteLayout.getPaperWritingAreaHeight(papers[pj], side);
      if (ha < minArea) minArea = ha;
      if (ha > maxArea) maxArea = ha;
    }

    // Long-note heuristic: even if the text technically fits on the current
    // note, very long notes should prefer starting on a larger/emptier sheet
    // when the current paper is small or nearly full.
    var isLongText = nextText != null && String(nextText).length >= LONG_NOTE_THRESHOLD;
    if (fitsCurrent && isLongText) {
      var spaceRemaining = writingAreaHeight - spaceAfterBox; // px remaining before this chunk
      var textLen = String(nextText).length;
      var heightPerChar = estimatedNext > 0 && textLen > 0 ? (estimatedNext / textLen) : 0;
      var remainingCharsApprox = heightPerChar > 0 ? spaceRemaining / heightPerChar : Infinity;
      var remainingFraction = writingAreaHeight > 0 ? (spaceRemaining / writingAreaHeight) : 0;
      var isCurrentSmallerThanMax = maxArea > 0 && writingAreaHeight < maxArea;
      var isPageNearlyFull = remainingFraction < 0.25;
      var remainingCharsLow = remainingCharsApprox < LONG_NOTE_THRESHOLD * 0.5;

      if (isCurrentSmallerThanMax || isPageNearlyFull || remainingCharsLow) {
        console.log(LOG_PREFIX, "  -> long note prefers new larger paper even though it fits", {
          writingAreaHeight: writingAreaHeight,
          spaceRemaining: spaceRemaining,
          estimatedNext: estimatedNext,
          remainingCharsApprox: remainingCharsApprox,
          minArea: minArea,
          maxArea: maxArea,
        });
        return { needNew: true, preferLargerPaper: true };
      }
    }

    if (fitsCurrent) return { needNew: false };

    var preferLargerPaper = papers.length > 1 && estimatedNext > minArea;

    console.log(LOG_PREFIX, "  -> need new", preferLargerPaper ? "(prefer larger paper)" : "");
    return { needNew: true, preferLargerPaper: preferLargerPaper };
  }

  function getCurrentPaperUrl(side) {
    var s = state[side];
    var wrapper = s && s.currentNote;
    return (wrapper && wrapper.dataset && wrapper.dataset.paperUrl) || null;
  }

  function write_new_note(side, options) {
    options = options || {};
    var region = getOrCreateRegion(side);
    if (!region) return null;

    var avoidPaperUrl = options.avoidPaperUrl || getCurrentPaperUrl(side);
    var paperUrl = options.paperUrl;
    if (paperUrl) {
      if (paperUrl === avoidPaperUrl) {
        paperUrl = null;
      } else {
        var available = getPaperImages();
        if (available.indexOf(paperUrl) === -1) {
          console.warn(LOG_PREFIX, "write_new_note request for unknown paper", paperUrl, "falling back to random selection");
          paperUrl = null;
        }
      }
    }
    if (!paperUrl && options.preferLargerPaper) {
      var papers = getPaperImages().filter(function (p) { return p !== avoidPaperUrl; });
      if (!papers.length) papers = getPaperImages();
      var bestUrl = papers[0];
      var bestArea = 0;
      for (var pi = 0; pi < papers.length; pi++) {
        var area = NoteLayout.getPaperWritingAreaHeight(papers[pi], side);
        if (area > bestArea) {
          bestArea = area;
          bestUrl = papers[pi];
        }
      }
      paperUrl = bestUrl;
    } else if (!paperUrl) {
      var list = getPaperImages().filter(function (p) { return p !== avoidPaperUrl; });
      paperUrl = (list.length ? list[Math.floor(Math.random() * list.length)] : getPaperImages()[0]) || randomPaperUrl();
    }

    var rotationDeg = NoteLayout.randomRotationDeg();
    var size = getPaperSize(paperUrl);
    var noteWidth = size.width;
    var noteHeight = size.height;
    var noteIndex = region.querySelectorAll(".note-page").length;

    // Default: stacked layout inside the philosopher panel.
    var pos = NoteLayout.stackedPositionInRegion(region, side, rotationDeg, noteWidth, noteHeight, noteIndex);

    // On large desktop, once the chat content has started scrolling, try to
    // anchor NEW notes near the user's most recent entry, offset by a
    // configurable amount with jitter.
    if (isLargeViewport() && chatHasStartedScrolling()) {
      var anchorEl = getLastUserMessageElement();
      if (anchorEl && typeof anchorEl.getBoundingClientRect === "function") {
        var regionRect = region.getBoundingClientRect();
        var anchorRect = anchorEl.getBoundingClientRect();
        var aabb = NoteLayout.rotatedNoteAABB(rotationDeg, noteWidth, noteHeight);
        var regionHeight = region.clientHeight;

        var topMin = Math.max(0, -aabb.minY);
        var topMax = Math.min(regionHeight, regionHeight - aabb.maxY);

        var baseOffset = DYNAMIC_ANCHOR_BASE_OFFSET_PX + randomJitterPx();
        var idealTop = (anchorRect.bottom - regionRect.top) + baseOffset;
        var anchoredTop = Math.max(topMin, Math.min(topMax, idealTop));

        var regionWidth = region.clientWidth;
        if (side === "left") {
          var leftMin = Math.max(0, -aabb.minX);
          var leftMax = Math.min(regionWidth, regionWidth - aabb.maxX);
          var leftRange = Math.max(0, Math.floor(leftMax - leftMin));
          var left = leftRange > 0 ? leftMin + Math.floor(Math.random() * (leftRange + 1)) : leftMin;
          left = Math.max(leftMin, Math.min(left, leftMax));
          pos = { left: left, right: undefined, top: anchoredTop };
        } else {
          var rightMin = Math.max(0, aabb.maxX - noteWidth);
          var rightMax = Math.min(regionWidth, regionWidth - noteWidth + aabb.minX);
          var rightRange = Math.max(0, Math.floor(rightMax - rightMin));
          var right = rightRange > 0 ? rightMin + Math.floor(Math.random() * (rightRange + 1)) : rightMin;
          right = Math.max(rightMin, Math.min(right, rightMax));
          pos = { left: undefined, right: right, top: anchoredTop };
        }
      }
    }

    var created = NoteElement.createNoteElement(side, paperUrl, pos, rotationDeg, size);
    applyNoteFormatStyles(created.contentEl, side);
    var sizing = applyPaperSizing(created.wrapper, side, paperUrl, size) || { noteWidth: noteWidth, noteHeight: noteHeight, writingAreaHeight: 0 };

    if (NOTE_DEBUG) {
      var debugBox = document.createElement("div");
      debugBox.className = "note-page__debug-box";
      debugBox.setAttribute("aria-hidden", "true");
      debugBox.style.cssText =
        "position:absolute;top:0;left:0;width:" + noteWidth + "px;height:" + noteHeight + "px;" +
        "border:2px solid #000;background:transparent;pointer-events:none;box-sizing:border-box;";
      var label = document.createElement("span");
      label.style.cssText = "position:absolute;top:2px;left:2px;background:#000;color:#fff;font-size:10px;padding:2px 4px;font-family:sans-serif;";
      var paperFilename = paperUrl.split("/").pop();
      label.textContent = paperFilename;
      debugBox.appendChild(label);
      created.wrapper.appendChild(debugBox);
    }

    region.appendChild(created.wrapper);
    NoteElement.registerNoteInteractions(created.wrapper, side, {
      onDestroy: function (w, s) {
        NoteElement.destroyNoteElement(w, s, function () {
          if (state[s] && state[s].currentNote === w) clearStateFor(s);
        });
      },
    });
    NoteElement.bringNoteToFront(created.wrapper, side);

    state[side] = {
      currentNote: created.wrapper,
      contentElement: created.contentEl,
      usedHeight: 0,
      writingAreaHeight: sizing.writingAreaHeight || 0,
    };
    console.log(LOG_PREFIX, "write_new_note(", side, ") created note, writingAreaHeight:", sizing.writingAreaHeight, "usedHeight: 0");

    return created.contentEl;
  }

  /**
   * Apply philosopher-specific note format from config via CSS custom properties.
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
    var DEBUG_TEXT_BOX_CLASS = NoteLayout.DEBUG_TEXT_BOX_CLASS;
    var paddingPx = NoteLayout.NOTE_BOX_PADDING_PX;

    if (s && s.currentNote) {
      NoteElement.bringNoteToFront(s.currentNote, side);
    }

    if (side === "right") {
      var bounds = NoteLayout.getCurrentTextBounds(contentEl, side);
      if (bounds) {
        var last = contentEl.lastElementChild;
        while (last && last.classList && last.classList.contains(DEBUG_TEXT_BOX_CLASS)) {
          last = last.previousElementSibling;
        }
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
        if (NOTE_DEBUG) {
          contentEl.classList.add("note-page__content--debug-overflow");
          var existing = contentEl.querySelectorAll("." + DEBUG_TEXT_BOX_CLASS);
          for (var e = 0; e < existing.length; e++) existing[e].remove();
          var bounds = NoteLayout.getCurrentTextBounds(contentEl, side);
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

  function bringNoteToFront(wrapper, side) {
    NoteElement.bringNoteToFront(wrapper, side);
  }

  function destroyNoteElement(wrapper, side) {
    NoteElement.destroyNoteElement(wrapper, side, function () {
      if (state[side] && state[side].currentNote === wrapper) clearStateFor(side);
    });
  }

  if (cfg && typeof cfg.onResponsiveScaleChange === "function") {
    cfg.onResponsiveScaleChange(handleResponsiveScaleUpdate);
  }

  global.notePages = {
    need_new_note: need_new_note,
    getCurrentPaperUrl: getCurrentPaperUrl,
    write_new_note: write_new_note,
    write_on_current_note: write_on_current_note,
    get_current_content_element: get_current_content_element,
    estimate_height: NoteLayout.estimateHeightForText,
    NOTE_BOX_PADDING_PX: NoteLayout.NOTE_BOX_PADDING_PX,
    NOTE_STACK_OFFSET_PCT: NoteLayout.NOTE_STACK_OFFSET_PCT,
    NOTE_STACK_JITTER_PCT: NoteLayout.NOTE_STACK_JITTER_PCT,
    getPanel: getPanel,
    getOrCreateRegion: getOrCreateRegion,
    bring_note_to_front: bringNoteToFront,
    destroy_note: destroyNoteElement,
  };
})(typeof window !== "undefined" ? window : this);
