(function (global) {
  "use strict";

  var editor = null;
  var cursorEl = null;
  var rafId = null;
  var focusKeeperCleanup = null;
  var focusRestoreRaf = null;
  var lastCursorOffset = null;
  var POINTER_EVENTS = ["pointerdown", "mousedown", "touchstart"];
  var BLUR_BYPASS_SELECTOR = "[data-permits-blur]";
  var prefersDesktopFocusLock =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
      : true;
  var lastAppliedText = "";

  function getEditor() {
    return editor;
  }

  function getValue() {
    return editor ? (editor.innerText || editor.textContent || "").trim() : "";
  }

  function getHtml() {
    return editor ? editor.innerHTML : "";
  }

  function setValue(value) {
    if (!editor) return;
    var text = value || "";
    editor.innerHTML =
      EDAUtils && EDAUtils.typewriterWrapTextForEditor
        ? EDAUtils.typewriterWrapTextForEditor(text)
        : EDAUtils.escapeHtml(text);
    lastAppliedText = text;
    updateCursorPosition();
  }

  function clear() {
    if (editor) {
      editor.innerHTML = "";
      lastAppliedText = "";
      updateCursorPosition();
    }
  }

  /**
   * Returns true if node is already a wrapped unit: <br> or <span> with one character.
   */
  function isWrappedNode(node) {
    if (node.nodeType === 3) return false;
    if (node.tagName === "BR") return true;
    if (node.tagName === "SPAN") {
      var t = node.textContent || "";
      return t.length === 1;
    }
    return false;
  }

  /**
   * Apply typewriter styling only to NEW characters. Preserve existing spans so
   * each letter's style is set once and never changes.
   */
  function applyLiveTypewriter() {
    if (!editor || !EDAUtils) return;
    var text = editor.innerText || editor.textContent || "";
    var offset = EDAUtils.getCursorOffset(editor);

    var keptCount = 0;
    var i, node;
    for (i = 0; i < editor.childNodes.length; i++) {
      node = editor.childNodes[i];
      if (isWrappedNode(node)) {
        keptCount += 1;
      } else {
        break;
      }
    }

    while (editor.childNodes.length > keptCount) {
      editor.removeChild(editor.childNodes[keptCount]);
    }
    var suffix = text.slice(keptCount);
    if (suffix.length > 0) {
      var wrap = document.createElement("div");
      wrap.innerHTML = EDAUtils.typewriterWrapTextForEditor(suffix);
      while (wrap.firstChild) {
        editor.appendChild(wrap.firstChild);
      }
    }
    EDAUtils.setCursorOffset(editor, Math.min(offset, text.length));
    rememberCursorOffset();
    lastAppliedText = text;
    editor.focus();
    updateCursorPosition();
    requestAnimationFrame(function () {
      updateCursorPosition();
    });
  }

  function updateCursorPosition() {
    if (!cursorEl || !editor) return;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      cursorEl.style.display = "none";
      return;
    }
    var range = sel.getRangeAt(0);
    if (range.collapsed !== true) {
      cursorEl.style.display = "none";
      return;
    }
    if (!editor.contains(range.startContainer)) {
      cursorEl.style.display = "none";
      return;
    }
    var rect = range.getBoundingClientRect();
    var wrapper = editor.parentNode;
    var containerRect = wrapper ? wrapper.getBoundingClientRect() : editor.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      var lastChild = editor.lastChild;
      if (lastChild) {
        var r = document.createRange();
        r.setStartAfter(lastChild);
        r.setEndAfter(lastChild);
        rect = r.getBoundingClientRect();
      }
      if (rect.width === 0 && rect.height === 0) {
        cursorEl.style.display = "none";
        return;
      }
    }
    cursorEl.style.display = "block";
    cursorEl.style.left = (rect.left - containerRect.left) + "px";
    cursorEl.style.top = (rect.top - containerRect.top) + "px";
    cursorEl.style.width = (rect.width || 2) + "px";
    cursorEl.style.height = (rect.height || 20) + "px";
    rememberCursorOffset();
  }

  function scheduleCursorUpdate() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(function () {
      rafId = null;
      updateCursorPosition();
    });
  }

  function rememberCursorOffset() {
    if (!editor || !EDAUtils || typeof EDAUtils.getCursorOffset !== "function") {
      lastCursorOffset = null;
      return;
    }
    lastCursorOffset = EDAUtils.getCursorOffset(editor);
  }

  function placeCaretAtEnd(node) {
    if (!node || typeof document === "undefined") return;
    var range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    var selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function shouldAllowBlur(target) {
    return !!(
      target &&
      typeof target.closest === "function" &&
      target.closest(BLUR_BYPASS_SELECTOR)
    );
  }

  function shouldForceFocus() {
    return !!prefersDesktopFocusLock;
  }

  function enforceEditorFocus() {
    if (!editor || document.hidden) return;
    if (document.activeElement !== editor) {
      editor.focus({ preventScroll: true });
    }
    if (
      EDAUtils &&
      typeof EDAUtils.setCursorOffset === "function" &&
      typeof lastCursorOffset === "number"
    ) {
      EDAUtils.setCursorOffset(editor, lastCursorOffset);
    } else {
      placeCaretAtEnd(editor);
    }
    rememberCursorOffset();
    scheduleCursorUpdate();
  }

  function requestFocusRestore() {
    if (!shouldForceFocus() || !editor || document.hidden) return;
    if (focusRestoreRaf) return;
    focusRestoreRaf = requestAnimationFrame(function () {
      focusRestoreRaf = null;
      enforceEditorFocus();
    });
  }

  function teardownFocusKeeper() {
    if (focusKeeperCleanup) {
      focusKeeperCleanup();
      focusKeeperCleanup = null;
    }
    if (focusRestoreRaf) {
      cancelAnimationFrame(focusRestoreRaf);
      focusRestoreRaf = null;
    }
  }

  function setupFocusKeeper() {
    teardownFocusKeeper();
    if (!editor || !shouldForceFocus()) return;

    var blurHandler = function (evt) {
      if (shouldAllowBlur(evt.relatedTarget || evt.target)) return;
      requestFocusRestore();
    };

    var pointerHandler = function (evt) {
      if (shouldAllowBlur(evt.target)) return;
      if (editor.contains && editor.contains(evt.target)) return;
      requestFocusRestore();
    };

    var visibilityHandler = function () {
      if (!document.hidden) {
        requestFocusRestore();
      }
    };

    editor.addEventListener("blur", blurHandler);
    POINTER_EVENTS.forEach(function (evtName) {
      document.addEventListener(evtName, pointerHandler, true);
    });
    document.addEventListener("visibilitychange", visibilityHandler);

    focusKeeperCleanup = function () {
      editor.removeEventListener("blur", blurHandler);
      POINTER_EVENTS.forEach(function (evtName) {
        document.removeEventListener(evtName, pointerHandler, true);
      });
      document.removeEventListener("visibilitychange", visibilityHandler);
    };

    requestFocusRestore();
  }

  function init() {
    teardownFocusKeeper();
    var wrap = document.getElementById("input-wrap");
    if (!wrap) return null;

    editor = wrap;
    editor.setAttribute("contenteditable", "true");
    editor.setAttribute("spellcheck", "false");

    var wrapper = editor.parentNode;
    if (wrapper) {
      cursorEl = document.createElement("div");
      cursorEl.className = "chat-cursor";
      cursorEl.setAttribute("aria-hidden", "true");
      wrapper.style.position = "relative";
      wrapper.appendChild(cursorEl);
    }

    var form = document.getElementById("form");
    editor.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          document.execCommand("insertLineBreak");
          applyLiveTypewriter();
        } else {
          var val = getValue();
          if (val.length > 0 && form) {
            if (typeof form.requestSubmit === "function") {
              form.requestSubmit();
            } else {
              form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
            }
          }
        }
      }
    });

    editor.addEventListener("input", function () {
      applyLiveTypewriter();
    });

    editor.addEventListener("selectionchange", function () {
      scheduleCursorUpdate();
    });
    document.addEventListener("selectionchange", scheduleCursorUpdate);

    editor.addEventListener("scroll", scheduleCursorUpdate);

    if (EDAUtils && EDAUtils.getCursorOffset) {
      editor.addEventListener("click", scheduleCursorUpdate);
      editor.addEventListener("keyup", scheduleCursorUpdate);
    }

    editor.focus();
    requestAnimationFrame(function () {
      if (editor && document.getElementById("input-wrap") === editor) {
        editor.focus();
        scheduleCursorUpdate();
        rememberCursorOffset();
      }
    });
    setupFocusKeeper();
    return editor;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.EDAChatInput = {
    getEditor: getEditor,
    getValue: getValue,
    getHtml: getHtml,
    setValue: setValue,
    clear: clear,
    init: init,
  };
})(typeof window !== "undefined" ? window : this);
