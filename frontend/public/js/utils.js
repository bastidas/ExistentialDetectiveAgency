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
    return (
      '<span style="opacity:' +
      opacity +
      "; text-shadow:" +
      x +
      "em " +
      y +
      "em currentColor;\">" +
      escapeHtml(char) +
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
    getCursorOffset: getCursorOffset,
    setCursorOffset: setCursorOffset,
  };
})(typeof window !== "undefined" ? window : this);
