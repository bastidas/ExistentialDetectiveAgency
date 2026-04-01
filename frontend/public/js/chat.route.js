(function () {
  "use strict";

  var chatState = {
    initialized: false,
    routeNode: null,
    attacheIntroStarted: false,
  };

  function restoreMessagesFromApiPayload(data) {
    if (!data || !Array.isArray(data.messages) || !data.messages.length) return false;
    if (!window.EDAMessageUI || !window.EDAMessageUI.addMessage) return false;

    var editorRef = window.EDAMessageUI.getEditorNode && window.EDAMessageUI.getEditorNode();
    var env = data.envelope || {};
    var up = data.userProgress || {};
    var pendingRefresh = up.pendingBaselineRefresh === true;
    var agentFromEnv = env.active_agent === "attache" ? "attache" : "detective";
    if (pendingRefresh) agentFromEnv = "attache";

    for (var i = 0; i < data.messages.length; i++) {
      var m = data.messages[i];
      var role = m && m.role === "assistant" ? "assistant" : "user";
      var text = m && m.text != null ? String(m.text) : "";
      var assistantAgent = "detective";
      if (m && m.agent === "attache") assistantAgent = "attache";
      else if (m && m.agent === "lumen") assistantAgent = "lumen";
      else if (m && m.agent === "umbra") assistantAgent = "umbra";
      if (role === "user") {
        window.EDAMessageUI.addMessage("user", text, editorRef, { skipAnimation: true });
      } else {
        window.EDAMessageUI.addMessage("assistant", text, editorRef, {
          skipAnimation: true,
          assistantAgent: assistantAgent,
          messageKind: m && m.kind ? String(m.kind) : null,
        });
      }
    }

    var detIntro =
      !pendingRefresh &&
      (data.detectiveIntroSent === true ||
        (up.baselineCompleted && agentFromEnv === "detective"));

    if (window.EDAChatSend && typeof window.EDAChatSend.restoreRoutingState === "function") {
      window.EDAChatSend.restoreRoutingState({
        baselineCompleted: !!up.baselineCompleted,
        detectiveIntroStarted: !!detIntro,
        activeAgent: agentFromEnv,
      });
    }

    if (window.EDARandomMarginItems && typeof window.EDARandomMarginItems.setMode === "function") {
      var baselineUiComplete = !!up.baselineCompleted && !pendingRefresh;
      window.EDARandomMarginItems.setMode(baselineUiComplete ? "normal" : "baseline");
    }

    chatState.attacheIntroStarted = true;
    if (window.EDAMessageUI && window.EDAMessageUI.runReadyForNextInput) {
      window.EDAMessageUI.runReadyForNextInput();
    }
    return true;
  }

  function startAttacheIntro() {
    if (chatState.attacheIntroStarted) return;
    chatState.attacheIntroStarted = true;

    setTimeout(function () {
      if (!window.EDAMessageUI) return;
      var editorRef = window.EDAMessageUI.getEditorNode && window.EDAMessageUI.getEditorNode();
      var wrapper = editorRef && editorRef.parentNode;
      if (wrapper) wrapper.classList.add("chat-editor-wrapper--hidden");

      var placeholder = window.EDAMessageUI.addAssistantPlaceholder && window.EDAMessageUI.addAssistantPlaceholder(editorRef);
      if (!placeholder) return;

      window.EDAMessageUI.setStatus("Thinking…");

      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message: "" }),
      })
        .then(function (res) {
          if (res.status === 204) {
            if (placeholder && placeholder.node) placeholder.node.remove();
            window.EDAMessageUI.setStatus("");
            if (window.EDAMessageUI.runReadyForNextInput) {
              window.EDAMessageUI.runReadyForNextInput();
            }
            return null;
          }
          return res.json().catch(function () { return {}; });
        })
        .then(function (data) {
          if (!data) return;
          if (!data.reply && data.error) {
            var msg = (function () {
              var kind = data.errorKind || "bad_request";
              return kind === "flex_busy"
                ? "Service busy (Flex). Please try again in a moment."
                : kind === "rate_limit"
                  ? "Too many requests. Please try again later."
                  : kind === "bad_request"
                    ? (data.error || "Invalid request. Check your message and try again.")
                    : (data.error || "Something went wrong. Please try again.");
            })();
            window.EDAMessageUI.setStatus(msg, true);
            if (placeholder && placeholder.contentEl) {
              placeholder.contentEl.textContent = msg;
            }
            if (window.EDAMessageUI.runReadyForNextInput) {
              window.EDAMessageUI.runReadyForNextInput();
            }
            return;
          }

          // Decide which agent responded (attaché vs detective) based on the
          // server-provided envelope, then set both the visible label and the
          // active agent state used for subsequent turns.
          var agent = (data.envelope && data.envelope.active_agent) ? data.envelope.active_agent : "attache";
          var cfg = window.EDAChatConfig || {};
          var label;
          if (agent === "detective") {
            label = cfg.AGENT_LABEL_DETECTIVE || cfg.AGENT_CHAT_LABEL || "DETECTIVE";
          } else {
            label = cfg.AGENT_LABEL_ATTACHE || "ATTACHÉ";
          }
          function runAfterLabel() {
            if (!placeholder || !placeholder.contentEl) return;
            var replyText = data.reply || "(No reply.)";
            if (window.EDAUtils && window.EDAUtils.animateAssistantText) {
              window.EDAUtils.animateAssistantText(placeholder.contentEl, replyText, {
                onDone: function () {
                  if (window.EDAMessageUI && window.EDAMessageUI.runReadyForNextInput) {
                    window.EDAMessageUI.runReadyForNextInput();
                  }
                },
              });
            } else {
              placeholder.contentEl.textContent = replyText;
              if (window.EDAMessageUI && window.EDAMessageUI.runReadyForNextInput) {
                window.EDAMessageUI.runReadyForNextInput();
              }
            }
          }

          if (placeholder && placeholder.labelEl) {
            if (window.EDAUtils && window.EDAUtils.typeLabelIntoElement) {
              window.EDAUtils.typeLabelIntoElement(placeholder.labelEl, label, {
                delayMs: 60,
                onDone: runAfterLabel,
              });
            } else {
              placeholder.labelEl.textContent = label;
              runAfterLabel();
            }
          } else {
            runAfterLabel();
          }
          if (window.EDAChatSend && typeof window.EDAChatSend.setActiveAgent === "function") {
            window.EDAChatSend.setActiveAgent(agent);
          }
          window.EDAMessageUI.setStatus("");
        })
        .catch(function (err) {
          window.EDAMessageUI.setStatus("Network error: " + (err && err.message ? err.message : err), true);
          if (placeholder && placeholder.contentEl) {
            placeholder.contentEl.textContent = "Network error: " + (err && err.message ? err.message : err);
          }
          if (window.EDAMessageUI.runReadyForNextInput) {
            window.EDAMessageUI.runReadyForNextInput();
          }
        });
    }, 1000);
  }

  function initChat() {
    if (chatState.initialized) return;
    var bootstrap = window.EDAChatBootstrap;
    if (typeof bootstrap === "function") {
      bootstrap();
      chatState.initialized = true;
    } else {
      console.error("[chat] Missing EDAChatBootstrap binding; chat cannot start.");
    }
  }

  function showChat() {
    var node = getRouteNode();
    if (node) {
      node.classList.remove("route--hidden");
      node.setAttribute("aria-hidden", "false");
    }
    document.body.dataset.chatVisible = "true";
    if (window.EDAMessageUI && typeof window.EDAMessageUI.runBlankChatIntro === "function") {
      // The Attaché intro handles showing the first assistant line and then
      // prompting the user; runBlankChatIntro is no longer called here.
    }
    fetch("/api/chat-state", { credentials: "same-origin" })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        });
      })
      .then(function (data) {
        if (restoreMessagesFromApiPayload(data)) {
          return;
        }
        startAttacheIntro();
      })
      .catch(function () {
        startAttacheIntro();
      });
  }

  function hideChat() {
    var node = getRouteNode();
    if (node) {
      node.setAttribute("aria-hidden", "true");
    }
    delete document.body.dataset.chatVisible;
  }

  function getRouteNode() {
    if (!chatState.routeNode) {
      chatState.routeNode = document.getElementById("route-chat");
    }
    return chatState.routeNode;
  }

  window.initChat = initChat;
  window.showChat = showChat;
  window.hideChat = hideChat;
})();
