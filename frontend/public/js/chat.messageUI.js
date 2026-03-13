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

  /** Return the editor wrapper (parent of input-wrap) when it is the insert ref. */
  function getEditorWrapper() {
    var messages = document.getElementById("messages");
    var ref = getMessagesInsertRef(messages, null);
    return ref || null;
  }

  /**
   * When the chat is entirely blank, type "QUERENT" then show the "Type here…" editor.
   * Call from showChat (or when chat route becomes visible). Idempotent: only runs when
   * #messages has no .message. A future DETECTIVE opener may run when chat is blank
   * (before or after this); keep the blank check easy to extend.
   */
  function runBlankChatIntro() {
    var messages = document.getElementById("messages");
    if (!messages) return;
    if (messages.querySelector(".message")) return;

    var ref = getMessagesInsertRef(messages, null);
    if (!ref) return;

    ref.classList.add("chat-editor-wrapper--hidden");

    function showQuerentIntroRow() {
      var div = document.createElement("div");
      div.className = "message querent-intro";
      var label = document.createElement("span");
      label.className = "label label--querent";
      label.textContent = "";
      div.appendChild(label);
      messages.insertBefore(div, ref);
      messages.scrollTop = messages.scrollHeight;

      function showEditor() {
        ref.classList.remove("chat-editor-wrapper--hidden");
        var editor = getEditorNode();
        if (editor && editor.focus) editor.focus();
      }

      if (EDAUtils && EDAUtils.typeLabelIntoElement) {
        EDAUtils.typeLabelIntoElement(label, "QUERENT", { delayMs: 60, onDone: showEditor });
      } else {
        label.textContent = "QUERENT";
        showEditor();
      }
    }

    function addAssistantIntro(text, agentLabel, onDone) {
      if (!text) {
        if (typeof onDone === "function") onDone();
        return;
      }
      if (!global.EDAMessageUI || !global.EDAMessageUI.addMessage) {
        if (typeof onDone === "function") onDone();
        return;
      }
      global.EDAMessageUI.addMessage("assistant", text, ref, {
        agentLabel: agentLabel,
        onAssistantDone: onDone,
      });
    }

    function runInitialIntrosThenQuerent() {
      if (typeof fetch === "undefined") {
        showQuerentIntroRow();
        return;
      }
      fetch("/api/initial-intros", { credentials: "same-origin" })
        .then(function (res) { return res && res.ok ? res.json() : null; })
        .then(function (data) {
          var attacheIntro = data && typeof data.attacheIntro === "string" ? data.attacheIntro.trim() : "";
          var detectiveIntro = data && typeof data.detectiveIntro === "string" ? data.detectiveIntro.trim() : "";

          // If no intros are available, fall back to just QUERENT.
          if (!attacheIntro && !detectiveIntro) {
            showQuerentIntroRow();
            return;
          }

          var attacheLabel = (global.EDAChatConfig && global.EDAChatConfig.AGENT_CHAT_LABEL) || "*** ATTACHÉ ***";
          var detectiveLabel = "*** DETECTIVE ***";

          // For initial arrival, only show one agent speaking first.
          // Prefer the Attaché; if that intro is unavailable, fall back to Detective.
          if (attacheIntro) {
            addAssistantIntro(attacheIntro, attacheLabel, function () {
              showQuerentIntroRow();
            });
          } else {
            addAssistantIntro(detectiveIntro, detectiveLabel, function () {
              showQuerentIntroRow();
            });
          }
        })
        .catch(function () {
          showQuerentIntroRow();
        });
    }

    runInitialIntrosThenQuerent();
  }

  /** Remove all standalone QUERENT intro rows (so only the new one is typed, or the user message is the only QUERENT). */
  function removeQuerentIntroIfPresent() {
    var messages = document.getElementById("messages");
    if (!messages) return;
    var intros = messages.querySelectorAll(".message.querent-intro");
    for (var i = 0; i < intros.length; i++) {
      intros[i].remove();
    }
  }

  /**
   * After a detective reply (or after no-reply), type "QUERENT" then focus the editor.
   * Inserts a standalone QUERENT row above the editor, types it (quickly), then focuses the editor.
   * Removes any existing querent-intro row so only the new one is typed.
   */
  function runReadyForNextInput() {
    var messages = document.getElementById("messages");
    if (!messages) return;
    var ref = getMessagesInsertRef(messages, null);
    if (!ref) return;

    removeQuerentIntroIfPresent();

    var div = document.createElement("div");
    div.className = "message querent-intro";
    var label = document.createElement("span");
    label.className = "label label--querent";
    label.textContent = "";
    div.appendChild(label);
    messages.insertBefore(div, ref);
    messages.scrollTop = messages.scrollHeight;

    function focusEditor() {
      var editor = getEditorNode();
      var wrapper = editor && editor.parentNode;
      if (wrapper) wrapper.classList.remove("chat-editor-wrapper--hidden");
      if (editor && editor.focus) editor.focus();
    }

    if (EDAUtils && EDAUtils.typeLabelIntoElement) {
      EDAUtils.typeLabelIntoElement(label, "QUERENT", { delayMs: 40, onDone: focusEditor });
    } else {
      label.textContent = "QUERENT";
      focusEditor();
    }
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

  /**
   * Insert an assistant placeholder row (empty label + empty content) for chatSend
   * to type "DETECTIVE" into and then fill with the reply.
   * @param {HTMLElement} [insertBefore] - Optional ref (e.g. editor node)
   * @returns {{ node: HTMLElement, labelEl: HTMLElement, contentEl: HTMLElement } | null}
   */
  function addAssistantPlaceholder(insertBefore) {
    var messages = document.getElementById("messages");
    var ref = getMessagesInsertRef(messages, insertBefore);
    if (!messages || !ref) return null;
    var div = document.createElement("div");
    div.className = "message assistant";
    var label = document.createElement("span");
    label.className = "label label--detective";
    label.textContent = "";
    var content = document.createElement("div");
    content.className = "content typewriter";
    div.appendChild(label);
    div.appendChild(content);
    messages.insertBefore(div, ref);
    messages.scrollTop = messages.scrollHeight;
    return { node: div, labelEl: label, contentEl: content };
  }

  function addMessage(role, text, insertBefore, options) {
    var messages = document.getElementById("messages");
    if (!messages) return;
    var ref = getMessagesInsertRef(messages, insertBefore);
    var div = document.createElement("div");
    div.className = "message " + role;
    var label = document.createElement("span");
    label.className = "label" + (role === "assistant" ? " label--detective" : " label--querent");
    if (role === "user") {
      label.textContent = "QUERENT";
    } else {
      var agentLabel =
        (options && options.agentLabel) ||
        (global.EDAChatConfig && global.EDAChatConfig.AGENT_CHAT_LABEL) ||
        "DETECTIVE";
      label.textContent = agentLabel;
    }
    var content = document.createElement("div");
    content.className = "content typewriter";
    if (role === "user") {
      content.innerHTML = EDAAnnotation.wrapAnnotationKeywords(text);
      content.setAttribute("data-applied-callouts", "[]");
      if (EDAUtils && EDAUtils.applyTypewriterToElement) {
        EDAUtils.applyTypewriterToElement(content);
      }
    } else {
      if (EDAUtils && EDAUtils.animateAssistantText) {
        var animateOpts = options && options.onAssistantDone ? { onDone: options.onAssistantDone } : undefined;
        EDAUtils.animateAssistantText(content, text, animateOpts);
      } else {
        content.innerHTML =
          EDAUtils && EDAUtils.typewriterWrapText
            ? EDAUtils.typewriterWrapText(text)
            : (EDAUtils && EDAUtils.escapeHtml ? EDAUtils.escapeHtml(text) : text);
        if (options && typeof options.onAssistantDone === "function") options.onAssistantDone();
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
    addAssistantPlaceholder: addAssistantPlaceholder,
    runBlankChatIntro: runBlankChatIntro,
    runReadyForNextInput: runReadyForNextInput,
    removeQuerentIntroIfPresent: removeQuerentIntroIfPresent,
    getEditorNode: getEditorNode,
  };
})(typeof window !== "undefined" ? window : this);
