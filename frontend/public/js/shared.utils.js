(function (global) {
  "use strict";

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function randomOpacity() {
    return (Math.floor(Math.random() * 50) + 50) / 100;
  }

  function randomEms() {
    return Math.random() > 0.8 ? (Math.floor(Math.random() * 100) - 50) / 800 : 0;
  }

  function typewriterWrapChar(char) {
    var opacity = randomOpacity();
    var x = randomEms();
    var y = randomEms();
    var safeChar = char === " " ? " " : escapeHtml(char);
    return (
      '<span style="opacity:' +
      opacity +
      "; text-shadow:" +
      x +
      "em " +
      y +
      "em currentColor;\">" +
      safeChar +
      "</span>"
    );
  }

  function typewriterWrapText(text) {
    if (!text) return "";
    return Array.from(text).map(typewriterWrapChar).join("");
  }

  function typewriterWrapTextForEditor(text) {
    if (!text) return "";
    return Array.from(text)
      .map(function (c) {
        return c === "\n" ? "<br>" : typewriterWrapChar(c);
      })
      .join("");
  }

  function applyTypewriterToElement(el) {
    if (!el || !el.firstChild) return;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    var n;
    while ((n = walker.nextNode())) textNodes.push(n);
    textNodes.forEach(function (node) {
      var text = node.textContent;
      if (!text) return;
      var fragment = document.createDocumentFragment();
      Array.from(text).forEach(function (char) {
        var span = document.createElement("span");
        span.style.opacity = randomOpacity();
        span.style.textShadow =
          randomEms() + "em " + randomEms() + "em currentColor";
        span.textContent = char;
        fragment.appendChild(span);
      });
      node.parentNode.replaceChild(fragment, node);
    });
  }

  /**
   * Animate assistant text into a container with a typewriter-style reveal.
   * Uses the existing per-character styling but reveals characters over time
   * instead of inserting the full string at once.
   */
  function animateAssistantText(container, text, options) {
    if (!container) return;
    var msg = String(text || "");
    if (!msg) {
      container.textContent = "";
      if (options && typeof options.onDone === "function") options.onDone();
      return;
    }

    var opts = options || {};
    var cfg = (global.EDAUtils && global.EDAUtils.TYPING_CONFIG) || {};
    var charsPerTick =
      typeof opts.charsPerTick === "number" && opts.charsPerTick > 0
        ? opts.charsPerTick
        : (typeof cfg.assistantCharsPerTick === "number" && cfg.assistantCharsPerTick > 0
            ? cfg.assistantCharsPerTick
            : 3);
    var tickMs =
      typeof opts.tickMs === "number" && opts.tickMs > 0
        ? opts.tickMs
        : (typeof cfg.assistantTickMs === "number" && cfg.assistantTickMs > 0
            ? cfg.assistantTickMs
            : 20);
    var maxChars =
      typeof cfg.assistantMaxChars === "number" && cfg.assistantMaxChars > 0
        ? cfg.assistantMaxChars
        : 0;

    // Respect reduced motion preferences by disabling the animation and
    // falling back to an instant render.
    var prefersReducedMotion = false;
    try {
      if (typeof window !== "undefined" && window.matchMedia) {
        prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }
    } catch (e) {}

    var respectReduced = cfg.respectReducedMotion !== false;

    if ((respectReduced && prefersReducedMotion) || opts.instant === true) {
      container.innerHTML = typewriterWrapText(msg);
      if (typeof opts.onDone === "function") opts.onDone();
      return;
    }

    container.innerHTML = "";
    var index = 0;
    var total = msg.length;

    if (maxChars && total > maxChars) {
      container.innerHTML = typewriterWrapText(msg);
      if (typeof opts.onDone === "function") opts.onDone();
      return;
    }

    function appendChunk() {
      if (index >= total) {
        return;
      }
      var end = index + charsPerTick;
      if (end > total) end = total;

      var fragment = document.createDocumentFragment();
      for (var i = index; i < end; i++) {
        var spanHtml = typewriterWrapChar(msg[i]);
        var tmp = document.createElement("span");
        tmp.innerHTML = spanHtml;
        while (tmp.firstChild) {
          fragment.appendChild(tmp.firstChild);
        }
      }
      container.appendChild(fragment);

      var messages = document.getElementById("messages");
      if (messages) {
        messages.scrollTop = messages.scrollHeight;
      }

      index = end;
      if (index < total) {
        var variation =
          typeof cfg.assistantTickVariationMs === "number" && cfg.assistantTickVariationMs > 0
            ? cfg.assistantTickVariationMs
            : 0;
        var delay = tickMs;
        if (variation > 0) {
          delay = tickMs + Math.floor(Math.random() * variation);
        }
        setTimeout(appendChunk, delay);
      } else if (typeof opts.onDone === "function") {
        opts.onDone();
      }
    }

    appendChunk();
  }

  /**
   * Type a label string into an element one character at a time (typewriter).
   * Respects prefers-reduced-motion by showing the full text immediately.
   * @param {HTMLElement} element - Target element (e.g. label span)
   * @param {string} text - Text to type (e.g. "QUERENT" or "DETECTIVE")
   * @param {Object} [options] - { delayMs: number, onDone: function }
   */
  function typeLabelIntoElement(element, text, options) {
    if (!element) return;
    var msg = String(text || "");
    var opts = options || {};
    var delayMs = typeof opts.delayMs === "number" && opts.delayMs >= 0 ? opts.delayMs : 60;
    var onDone = typeof opts.onDone === "function" ? opts.onDone : null;

    var prefersReducedMotion = false;
    try {
      if (typeof window !== "undefined" && window.matchMedia) {
        prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }
    } catch (e) {}

    if (prefersReducedMotion || opts.instant === true) {
      element.textContent = msg;
      if (onDone) onDone();
      return;
    }

    element.textContent = "";
    var index = 0;
    var total = msg.length;

    function typeNext() {
      if (index >= total) {
        if (onDone) onDone();
        return;
      }
      element.textContent = msg.slice(0, index + 1);
      index += 1;
      setTimeout(typeNext, delayMs);
    }
    typeNext();
  }

  /**
   * Returns the character offset (0-based index) before the cursor.
   * Walks all nodes in document order so text nodes inserted by the browser are counted.
   */
  function getCursorOffset(container) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    var range = sel.getRangeAt(0);
    var start = range.startContainer;
    var startOffset = range.startOffset;
    if (!container.contains(start) && container !== start) return 0;
    var r = document.createRange();
    r.setStart(container, 0);
    r.setEnd(start, startOffset);
    return r.toString().length;
  }

  /**
   * Places the cursor at the given character offset (0-based).
   * Editor structure: direct children are one span per character or <br> for newline.
   */
  function setCursorOffset(container, offset) {
    var sel = window.getSelection();
    if (!sel) return;
    var kids = container.children;
    if (kids.length === 0) {
      var emptyRange = document.createRange();
      emptyRange.setStart(container, 0);
      emptyRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(emptyRange);
      return;
    }
    var totalChars = 0;
    var i, node, len;
    for (i = 0; i < kids.length; i++) {
      node = kids[i];
      len = node.tagName === "BR" ? 1 : (node.textContent || "").length;
      totalChars += len;
    }
    offset = Math.max(0, Math.min(offset, totalChars));
    var range = document.createRange();
    var count = 0;
    for (i = 0; i < kids.length; i++) {
      node = kids[i];
      len = node.tagName === "BR" ? 1 : (node.textContent || "").length;
      if (count + len >= offset) {
        var posInNode = offset - count;
        if (node.tagName === "BR") {
          range.setStartAfter(node);
          range.setEndAfter(node);
        } else if (posInNode <= 0) {
          range.setStart(node, 0);
          range.setEnd(node, 0);
        } else {
          var textLen = (node.textContent || "").length;
          var ch = Math.min(posInNode, textLen);
          range.setStart(node, ch);
          range.setEnd(node, ch);
        }
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      count += len;
    }
    range.setStartAfter(kids[kids.length - 1]);
    range.setEndAfter(kids[kids.length - 1]);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  global.EDAUtils = {
    escapeHtml: escapeHtml,
    escapeRegex: escapeRegex,
    typewriterWrapText: typewriterWrapText,
    typewriterWrapTextForEditor: typewriterWrapTextForEditor,
    applyTypewriterToElement: applyTypewriterToElement,
    animateAssistantText: animateAssistantText,
    typeLabelIntoElement: typeLabelIntoElement,
    getCursorOffset: getCursorOffset,
    setCursorOffset: setCursorOffset,
  };
})(typeof window !== "undefined" ? window : this);
