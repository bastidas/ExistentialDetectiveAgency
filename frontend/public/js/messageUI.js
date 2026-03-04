(function (global) {
  "use strict";

  var LINE_DURATION_MS = 1500;

  function setStatus(text, isError) {
    var status = document.getElementById("status");
    if (!status) return;
    status.textContent = text;
    status.className = "status " + (isError ? "error" : "");
  }

  function getEditorNode() {
    return document.getElementById("input-wrap");
  }

  /** Return the direct child of messages to use as insertBefore ref (editor is inside a wrapper). */
  function getMessagesInsertRef(messages, explicitRef) {
    var ref = explicitRef || getEditorNode();
    if (!ref || !messages) return null;
    if (ref.parentNode === messages) return ref;
    if (ref.parentNode && ref.parentNode.parentNode === messages) return ref.parentNode;
    return ref;
  }

  function addUserBlock(html) {
    var messages = document.getElementById("messages");
    var ref = getMessagesInsertRef(messages, null);
    if (!messages || !ref) return;
    var block = document.createElement("div");
    block.className = "chat-user-block typewriter";
    block.innerHTML = html;
    messages.insertBefore(block, ref);
    messages.scrollTop = messages.scrollHeight;
  }

  function addSeparatorLine(callback, insertBefore) {
    var messages = document.getElementById("messages");
    if (!messages) {
        if (callback) callback();
        return;
    }
    var ref = getMessagesInsertRef(messages, insertBefore);
    var wrap = document.createElement("div");
    wrap.className = "chat-paper-line";
    wrap.setAttribute("aria-hidden", "true");
    var inner = document.createElement("div");
    inner.className = "line-inner";
    wrap.appendChild(inner);
    if (ref) {
      messages.insertBefore(wrap, ref);
    } else {
      messages.appendChild(wrap);
    }
    messages.scrollTop = messages.scrollHeight;

    var called = false;
    function onDone() {
      if (called) return;
      called = true;
      if (callback) callback();
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        inner.classList.add("drawn");
        inner.addEventListener("transitionend", function () {
          onDone();
        }, { once: true });
        setTimeout(onDone, LINE_DURATION_MS + 100);
      });
    });
  }

  function addMessage(role, text, insertBefore, options) {
    var messages = document.getElementById("messages");
    if (!messages) return;
    var ref = getMessagesInsertRef(messages, insertBefore);
    var div = document.createElement("div");
    div.className = "message " + role;
    var label = document.createElement("span");
    label.className = "label";
    label.textContent = role === "user" ? "You" : "Assistant";
    var content = document.createElement("div");
    content.className = "content typewriter";
    if (role === "user") {
      content.innerHTML = EDAAnnotation.wrapAnnotationKeywords(text);
      if (EDAUtils && EDAUtils.applyTypewriterToElement) {
        EDAUtils.applyTypewriterToElement(content);
      }
    } else {
      content.innerHTML =
        EDAUtils && EDAUtils.typewriterWrapText
          ? EDAUtils.typewriterWrapText(text)
          : EDAUtils.escapeHtml(text);
    }
    div.appendChild(label);
    div.appendChild(content);
    if (ref) {
      messages.insertBefore(div, ref);
    } else {
      messages.appendChild(div);
    }
    messages.scrollTop = messages.scrollHeight;
    if (role === "user" && EDAAnnotation.applyRoughNotationToKeywordSpans) {
      var philosopher = options && options.philosopher;
      EDAAnnotation.applyRoughNotationToKeywordSpans(content, philosopher);
    }
  }

  global.EDAMessageUI = {
    setStatus: setStatus,
    addMessage: addMessage,
    addUserBlock: addUserBlock,
    addSeparatorLine: addSeparatorLine,
    getEditorNode: getEditorNode,
  };
})(typeof window !== "undefined" ? window : this);
