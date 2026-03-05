(function (global) {
  "use strict";

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

  function addMessage(role, text, insertBefore, options) {
    var messages = document.getElementById("messages");
    if (!messages) return;
    var ref = getMessagesInsertRef(messages, insertBefore);
    var div = document.createElement("div");
    div.className = "message " + role;
    var label = document.createElement("span");
    label.className = "label" + (role === "assistant" ? " label--detective" : " label--querent");
    label.textContent = role === "user" ? "QUERENT" : "DETECTIVE";
    var content = document.createElement("div");
    content.className = "content typewriter";
    if (role === "user") {
      content.innerHTML = EDAAnnotation.wrapAnnotationKeywords(text);
      if (EDAUtils && EDAUtils.applyTypewriterToElement) {
        EDAUtils.applyTypewriterToElement(content);
      }
    } else {
      if (EDAUtils && EDAUtils.animateAssistantText) {
        EDAUtils.animateAssistantText(content, text);
      } else {
        content.innerHTML =
          EDAUtils && EDAUtils.typewriterWrapText
            ? EDAUtils.typewriterWrapText(text)
            : (EDAUtils && EDAUtils.escapeHtml ? EDAUtils.escapeHtml(text) : text);
      }
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
    getEditorNode: getEditorNode,
  };
})(typeof window !== "undefined" ? window : this);
