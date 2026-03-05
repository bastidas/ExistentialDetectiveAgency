(function (global) {
  "use strict";

  var escapeHtml = global.EDAUtils && global.EDAUtils.escapeHtml;
  var escapeRegex = global.EDAUtils && global.EDAUtils.escapeRegex;

  /**
   * Wrap keyword matches in text with <strong>. Word-boundary, case-insensitive.
   * Keywords should be sorted by length descending to match longer first.
   */
  function wrapKeywords(text, keywords) {
    if (!keywords || keywords.length === 0) return escapeHtml(text);
    var escaped = escapeHtml(text);
    var sorted = keywords.slice().sort(function (a, b) {
      return b.length - a.length;
    });
    sorted.forEach(function (kw) {
      if (!kw) return;
      var re = new RegExp("\\b(" + escapeRegex(kw) + ")\\b", "gi");
      escaped = escaped.replace(re, "<strong>$1</strong>");
    });
    return escaped;
  }

  /**
   * Append and reveal text with a handwriter effect.
   * @param {HTMLElement} containerElement - Parent to append into (#left-philosopher-content or #right-philosopher-content)
   * @param {string} rawText - Plain text to reveal
   * @param {Object} options - { baseDelayMs, variationMs, useLinedLayout, keywords, shortNoteRotationDeg }
   *   - baseDelayMs: base delay per character (e.g. 90)
   *   - variationMs: random 0..variationMs added per character (e.g. 30)
   *   - useLinedLayout: if true, use right-panel lined layout (no keyword underlining in philosopher notes)
   *   - keywords: optional array; if useLinedLayout and keywords.length > 0, underline those words in the note (not used for philosopher notes; only user chat is annotated)
   *   - shortNoteRotationDeg: optional number; if set, rotate the text block (e.g. for 1–3 word jots)
   * @returns {Promise} Resolves when full text has been revealed
   */
  function appendText(containerElement, rawText, options) {
    options = options || {};
    var baseDelayMs = options.baseDelayMs != null ? options.baseDelayMs : 90;
    var variationMs = options.variationMs != null ? options.variationMs : 30;
    var useLinedLayout = options.useLinedLayout === true;
    var keywords = options.keywords;

    if (!containerElement || !rawText) return Promise.resolve();

    var useRight = useLinedLayout;
    var keywordsForRight = (useLinedLayout && Array.isArray(keywords)) ? keywords : [];

    if (!useRight) {
      return appendTextLeft(containerElement, rawText, baseDelayMs, variationMs, options);
    }
    return appendTextRight(containerElement, rawText, baseDelayMs, variationMs, keywordsForRight, options);
  }

  function nextDelay(baseMs, variationMs) {
    return baseMs + Math.random() * (variationMs || 0);
  }

  function appendTextLeft(container, text, baseDelayMs, variationMs, options) {
    options = options || {};
    var div = document.createElement("div");
    div.className = "handwritten";
    if (options.shortNoteRotationDeg != null) {
      div.style.transform = "rotate(" + options.shortNoteRotationDeg + "deg)";
      div.style.transformOrigin = "top left";
      div.style.whiteSpace = "pre-wrap"; /* preserve leading spaces */
    }
    container.appendChild(div);
    var i = 0;
    return new Promise(function (resolve) {
      function step() {
        if (i >= text.length) {
          scrollContainer(container);
          resolve();
          return;
        }
        div.textContent += text[i];
        i += 1;
        scrollContainer(container);
        setTimeout(step, nextDelay(baseDelayMs, variationMs));
      }
      step();
    });
  }

  function appendTextRight(container, text, baseDelayMs, variationMs, keywords, options) {
    options = options || {};
    var disableScroll = options.disableScroll === true;

    var wrap = document.createElement("div");
    wrap.className = "container";
    if (options.startBelowMarginPx != null && options.startBelowMarginPx !== 0) {
      wrap.style.marginTop = options.startBelowMarginPx + "px";
    }
    if (options.shortNoteRotationDeg != null) {
      wrap.style.transform = "rotate(" + options.shortNoteRotationDeg + "deg)";
      wrap.style.transformOrigin = "top left";
      wrap.style.whiteSpace = "pre-wrap"; /* preserve leading spaces */
    }
    container.appendChild(wrap);

    var lines = [];
    var lineEls = [];
    var currentLine = document.createElement("div");
    currentLine.className = "line";
    var span = document.createElement("span");
    currentLine.appendChild(span);
    wrap.appendChild(currentLine);
    lineEls.push(span);
    lines.push("");

    var i = 0;
    var lineIndex = 0;
    return new Promise(function (resolve) {
      function step() {
        if (i >= text.length) {
          if (!disableScroll) scrollContainer(container);
          resolve();
          return;
        }
        var ch = text[i];
        i += 1;
        if (ch === "\n") {
          currentLine = document.createElement("div");
          currentLine.className = "line";
          span = document.createElement("span");
          currentLine.appendChild(span);
          wrap.appendChild(currentLine);
          lineEls.push(span);
          lines.push("");
          lineIndex += 1;
        } else {
          lines[lineIndex] += ch;
          span.innerHTML = wrapKeywords(lines[lineIndex], keywords);
        }
        if (!disableScroll) scrollContainer(container);
        setTimeout(step, nextDelay(baseDelayMs, variationMs));
      }
      step();
    });
  }

  function scrollContainer(container) {
    if (container && container.scrollHeight > container.clientHeight) {
      container.scrollTop = container.scrollHeight;
    }
  }

  global.handwriter = {
    appendText: appendText,
    wrapKeywords: wrapKeywords,
  };
})(typeof window !== "undefined" ? window : this);
