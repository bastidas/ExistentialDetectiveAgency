(function (global) {
  "use strict";

  var NOTE_DELAY_MS = 40;

  // Philosopher self-dialog: delay before optional follow-up request (ms)
  var PHILOSOPHER_SELF_DIALOG_TIME = 500;
  // Probability we request left/right philosopher in the follow-up (0–1)
  var LEFT_PHILOSOPHER_INTERACTION_RATE = 0.4;
  var RIGHT_PHILOSOPHER_INTERACTION_RATE = 0.6;

  var leftPhilosopherHistory = [];
  var rightPhilosopherHistory = [];

  /** Prevents double-send when submit fires twice (e.g. easter-egg path or fast double Enter). */
  var sending = false;

  /** Returns display string for chat error response (data.reply absent, data.error present). */
  function chatErrorToMessage(data) {
    var kind = data.errorKind || "bad_request";
    return kind === "flex_busy"
      ? "Service busy (Flex). Please try again in a moment."
      : kind === "rate_limit"
        ? "Too many requests. Please try again later."
        : kind === "bad_request"
          ? (data.error || "Invalid request. Check your message and try again.")
          : (data.error || "Something went wrong. Please try again.");
  }

  /** True if any philosopher response/notes field is present. */
  function hasPhilosopherContent(data) {
    return !!(
      data.leftPhilosopherUserResponse ||
      data.leftPhilosopherOtherResponse ||
      (Array.isArray(data.leftPhilosopherNotes) && data.leftPhilosopherNotes.length > 0) ||
      data.rightPhilosopherUserResponse ||
      data.rightPhilosopherOtherResponse ||
      (Array.isArray(data.rightPhilosopherNotes) && data.rightPhilosopherNotes.length > 0)
    );
  }

  /** True if the given side has philosopher response or notes. */
  function hasPhilosopherContentForSide(data, side) {
    var s = (side === "right" ? "right" : "left");
    if (s === "left") {
      return !!(
        data.leftPhilosopherUserResponse ||
        data.leftPhilosopherOtherResponse ||
        (Array.isArray(data.leftPhilosopherNotes) && data.leftPhilosopherNotes.length)
      );
    }
    return !!(
      data.rightPhilosopherUserResponse ||
      data.rightPhilosopherOtherResponse ||
      (Array.isArray(data.rightPhilosopherNotes) && data.rightPhilosopherNotes.length)
    );
  }

  /** Normalize API response to payload { left: { response, notes }, right: { response, notes } }.
   *  Combines user-facing and other-philosopher-facing responses into a single stream per side,
   *  marking the other-philosopher response so it reads as a distinct marginal remark.
   */
  function toPhilosopherPayload(data) {
    function buildSidePayload(userKey, otherKey, notesKey) {
      var userText = (data[userKey] || "").trim();
      var otherText = (data[otherKey] || "").trim();
      var pieces = [];
      if (userText) pieces.push(userText);
      if (otherText) {
        // Visually distinguish philosopher-to-philosopher remarks without changing layout.
        pieces.push("[To the other philosopher] " + otherText);
      }
      var combined = pieces.join("\n\n");
      var notes = Array.isArray(data[notesKey]) ? data[notesKey] : [];
      return { response: combined, notes: notes };
    }
    return {
      left: buildSidePayload(
        "leftPhilosopherUserResponse",
        "leftPhilosopherOtherResponse",
        "leftPhilosopherNotes"
      ),
      right: buildSidePayload(
        "rightPhilosopherUserResponse",
        "rightPhilosopherOtherResponse",
        "rightPhilosopherNotes"
      ),
    };
  }

  /**
   * Apply philosopher response: optionally push to history and append to panels.
   * @param payload - { left: { response, notes }, right: { response, notes } }
   * @param options - pushHistory (push both), or pushHistoryLeft/pushHistoryRight (per-side); appendLeft, appendRight
   */
  function applyPhilosopherResponse(payload, options) {
    var opts = options || {};
    var pushHistory = opts.pushHistory !== false;
    var pushLeft = opts.pushHistoryLeft !== undefined ? opts.pushHistoryLeft : pushHistory;
    var pushRight = opts.pushHistoryRight !== undefined ? opts.pushHistoryRight : pushHistory;
    var appendLeft = opts.appendLeft !== false;
    var appendRight = opts.appendRight !== false;

    if (pushLeft) leftPhilosopherHistory.push(payload.left);
    if (pushRight) rightPhilosopherHistory.push(payload.right);

    var promises = [];
    if (appendLeft && (payload.left.response || payload.left.notes.length)) {
      promises.push(
        EDARules.appendPhilosopherContent("left", payload.left.response, payload.left.notes).catch(function (err) {
          console.warn("[chatSend] philosopher left panel:", err);
        })
      );
    }
    if (appendRight && (payload.right.response || payload.right.notes.length)) {
      promises.push(
        EDARules.appendPhilosopherContent("right", payload.right.response, payload.right.notes).catch(function (err) {
          console.warn("[chatSend] philosopher right panel:", err);
        })
      );
    }
    return Promise.all(promises);
  }

  function handlePhilosopherDialogResponse(dialogData, requestLeft, requestRight) {
    console.log(
      "[DEBUG] Philosopher dialog response; left content:",
      hasPhilosopherContentForSide(dialogData, "left"),
      " right content:",
      hasPhilosopherContentForSide(dialogData, "right")
    );
    var payload = toPhilosopherPayload(dialogData);
    applyPhilosopherResponse(payload, {
      pushHistoryLeft: requestLeft && hasPhilosopherContentForSide(dialogData, "left"),
      pushHistoryRight: requestRight && hasPhilosopherContentForSide(dialogData, "right"),
      appendLeft: requestLeft,
      appendRight: requestRight,
    });
  }

  function schedulePhilosopherDialog() {
    setTimeout(function () {
      var requestLeft = Math.random() < LEFT_PHILOSOPHER_INTERACTION_RATE;
      var requestRight = Math.random() < RIGHT_PHILOSOPHER_INTERACTION_RATE;
      console.log(
        "[DEBUG] Philosopher self-dialog: requestLeft=" + requestLeft + " requestRight=" + requestRight,
        "(left turns: " + leftPhilosopherHistory.length + ", right turns: " + rightPhilosopherHistory.length + ")"
      );
      if (!requestLeft && !requestRight) return;
      var dialogPayload = {
        leftPhilosopherTurns: leftPhilosopherHistory,
        rightPhilosopherTurns: rightPhilosopherHistory,
        requestLeft: requestLeft,
        requestRight: requestRight,
      };
      fetch("/api/philosopher-dialog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(dialogPayload),
      })
        .then(function (res) {
          return res.ok ? res.json() : res.json().then(function (j) { throw new Error(j.error || res.statusText); });
        })
        .then(function (dialogData) {
          handlePhilosopherDialogResponse(dialogData, requestLeft, requestRight);
        })
        .catch(function (err) {
          console.warn("[chatSend] Philosopher dialog request failed:", err.message);
        });
    }, PHILOSOPHER_SELF_DIALOG_TIME);
  }

  function handlePhilosopherContent(data) {
    if (!hasPhilosopherContent(data)) {
      leftPhilosopherHistory.push({ response: "", notes: [] });
      rightPhilosopherHistory.push({ response: "", notes: [] });
      return;
    }
    var payload = toPhilosopherPayload(data);
    applyPhilosopherResponse(payload, { pushHistory: true, appendLeft: true, appendRight: true });
    schedulePhilosopherDialog();
  }

  function handleChatResponse(data, editorRef) {
    if (!data.reply && data.error) {
      var displayMsg = chatErrorToMessage(data);
      EDAMessageUI.setStatus(displayMsg, true);
      EDAMessageUI.addMessage("assistant", displayMsg, editorRef);
      return;
    }
    EDAMessageUI.setStatus("");
    if (data.debug) {
      console.log(
        "[DEBUG] user exchanges:",
        data.debug.userExchanges + "/" + data.debug.maxUserExchanges
      );
      console.log(
        "[DEBUG] daily usage:",
        data.debug.dailyUsage + "/" + data.debug.maxDailyUsage
      );
    }
    console.log("[DEBUG] Main chat response received; philosopher fields present:", hasPhilosopherContent(data));
    EDAMessageUI.addMessage("assistant", data.reply || "(No reply)", editorRef);
    handlePhilosopherContent(data);
    if (global.EDARandomMarginItems && typeof global.EDARandomMarginItems.maybeDropRandomItemForUserInput === "function") {
      var leftHasContent = hasPhilosopherContentForSide(data, "left");
      var rightHasContent = hasPhilosopherContentForSide(data, "right");
      var sideHint = null;
      if (leftHasContent && !rightHasContent) {
        sideHint = "left";
      } else if (rightHasContent && !leftHasContent) {
        sideHint = "right";
      }
      global.EDARandomMarginItems.maybeDropRandomItemForUserInput({ side: sideHint });
    }
    if (Array.isArray(data.philosopherNotes) && data.philosopherNotes.length > 0) {
      var seq = Promise.resolve();
      data.philosopherNotes.forEach(function (note) {
        if (typeof note !== "string") return;
        seq = seq.then(function () {
          return EDARules.appendPhilosopherNoteToBothPanels(note);
        });
      });
    }
  }

  function focusEditor(atEnd) {
    var editorNode = EDAChatInput && EDAChatInput.getEditor ? EDAChatInput.getEditor() : null;
    if (!editorNode) return;
    editorNode.focus();
    if (EDAUtils && EDAUtils.setCursorOffset && atEnd) {
      var len = EDAChatInput && EDAChatInput.getValue ? (EDAChatInput.getValue() || "").length : 0;
      EDAUtils.setCursorOffset(editorNode, len);
    }
  }

  function animateRewriteInInput(rewriteInfo, options) {
    options = options || {};
    var preserveSubmitDisabled = options.preserveSubmitDisabled === true;
    var editor = EDAChatInput && EDAChatInput.getEditor ? EDAChatInput.getEditor() : null;
    var submitBtn = document.getElementById("submit");
    if (!editor || !submitBtn) return Promise.resolve(rewriteInfo.newMessage);

    var rule = rewriteInfo.rule;
    var idx = rewriteInfo.index;
    var newMessage = rewriteInfo.newMessage;
    var current = EDAChatInput.getValue();
    var toRemove = rule.userText.length;
    var toAdd = rule.respondText;

    editor.setAttribute("contenteditable", "false");
    submitBtn.disabled = true;

    return new Promise(function (resolve) {
      function deleteNext() {
        if (toRemove <= 0) {
          typeNext(0);
          return;
        }
        EDAChatInput.setValue(current.slice(0, idx) + current.slice(idx + 1));
        current = EDAChatInput.getValue();
        toRemove -= 1;
        setTimeout(deleteNext, NOTE_DELAY_MS);
      }
      function typeNext(j) {
        if (j >= toAdd.length) {
          editor.setAttribute("contenteditable", "true");
          if (!preserveSubmitDisabled) {
            submitBtn.disabled = false;
          }
          resolve(newMessage);
          return;
        }
        EDAChatInput.setValue(
          current.slice(0, idx) +
            toAdd.slice(0, j + 1) +
            current.slice(idx)
        );
        current = EDAChatInput.getValue();
        setTimeout(function () {
          typeNext(j + 1);
        }, NOTE_DELAY_MS);
      }
      deleteNext();
    });
  }

  function doSendMessage(messageToSend, userBlockHtml, options) {
    options = options || {};
    var deferInputClear = options.deferInputClear === true;
    if (sending) return;
    sending = true;

    var submitBtn = document.getElementById("submit");
    var editorRef = EDAMessageUI.getEditorNode && EDAMessageUI.getEditorNode();
    // Always add user message via addMessage so it gets annotated (keyword/highlight/strike).
    EDAMessageUI.addMessage("user", messageToSend);
    if (EDAChatInput && EDAChatInput.clear && !deferInputClear) {
      EDAChatInput.clear();
      focusEditor(true);
    }
    if (submitBtn) submitBtn.disabled = true;
    EDAMessageUI.setStatus("Thinking…");

    function onDone() {
      sending = false;
      if (submitBtn) submitBtn.disabled = false;
      focusEditor(true);
    }

    function runFetch() {
      console.log("[DEBUG] Sending main chat request", messageToSend ? "(message length: " + messageToSend.length + ")" : "");
      var payload = { message: messageToSend };
      if (typeof global.NoteFormatConfig !== "undefined" && global.NoteFormatConfig.getContentWidthCharsForHint) {
        var contentWidthChars = global.NoteFormatConfig.getContentWidthCharsForHint();
        if (typeof contentWidthChars === "number" && contentWidthChars > 0) {
          payload.contentWidthChars = contentWidthChars;
        }
      }
      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (res.status === 204) {
            EDAMessageUI.setStatus("");
            return null;
          }
          return res.json().catch(function () {
            return {};
          });
        })
        .then(function (data) {
          if (!data) return;
          if (!data.reply && data.error) {
            var msg = chatErrorToMessage(data);
            EDAMessageUI.setStatus(msg, true);
            EDAMessageUI.addMessage("assistant", msg, editorRef);
            return;
          }
          handleChatResponse(data, editorRef);
        })
        .catch(function (err) {
          EDAMessageUI.setStatus("Network error: " + err.message, true);
        })
        .finally(onDone);
    }

    runFetch();
  }

  global.EDAChatSend = {
    doSendMessage: doSendMessage,
    animateRewriteInInput: animateRewriteInInput,
  };
})(typeof window !== "undefined" ? window : this);
