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

  function animateRewriteInInput(rewriteInfo) {
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
          submitBtn.disabled = false;
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

  function doSendMessage(messageToSend, userBlockHtml) {
    if (sending) return;
    sending = true;

    var submitBtn = document.getElementById("submit");
    var editorRef = EDAMessageUI.getEditorNode && EDAMessageUI.getEditorNode();
    // Always add user message via addMessage so it gets annotated (keyword/highlight/strike).
    EDAMessageUI.addMessage("user", messageToSend);
    if (EDAChatInput && EDAChatInput.clear) EDAChatInput.clear();
    if (submitBtn) submitBtn.disabled = true;
    EDAMessageUI.setStatus("Thinking…");

    function onDone() {
      sending = false;
      if (submitBtn) submitBtn.disabled = false;
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
            var kind = data.errorKind || "bad_request";
            var displayMsg =
              kind === "flex_busy"
                ? "Service busy (Flex). Please try again in a moment."
                : kind === "rate_limit"
                  ? "Too many requests. Please try again later."
                  : kind === "bad_request"
                    ? (data.error ||
                      "Invalid request. Check your message and try again.")
                    : (data.error ||
                      "Something went wrong. Please try again.");
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
          var hasPhilosopherFields =
            data.leftPhilosopherResponse != null ||
            (Array.isArray(data.leftPhilosopherNotes) && data.leftPhilosopherNotes.length > 0) ||
            data.rightPhilosopherResponse != null ||
            (Array.isArray(data.rightPhilosopherNotes) && data.rightPhilosopherNotes.length > 0);
          console.log("[DEBUG] Main chat response received; philosopher fields present:", hasPhilosopherFields);
          EDAMessageUI.addMessage("assistant", data.reply || "(No reply)", editorRef);

          var hasStructured =
            data.leftPhilosopherResponse != null ||
            (Array.isArray(data.leftPhilosopherNotes) &&
              data.leftPhilosopherNotes.length > 0) ||
            data.rightPhilosopherResponse != null ||
            (Array.isArray(data.rightPhilosopherNotes) &&
              data.rightPhilosopherNotes.length > 0);
          if (hasStructured) {
            var leftResp = data.leftPhilosopherResponse || "";
            var leftNotes = Array.isArray(data.leftPhilosopherNotes) ? data.leftPhilosopherNotes : [];
            var rightResp = data.rightPhilosopherResponse || "";
            var rightNotes = Array.isArray(data.rightPhilosopherNotes) ? data.rightPhilosopherNotes : [];
            leftPhilosopherHistory.push({ response: leftResp, notes: leftNotes });
            rightPhilosopherHistory.push({ response: rightResp, notes: rightNotes });
            var leftPromise = EDARules.appendLeftPhilosopherContent(leftResp, leftNotes);
            var rightPromise = EDARules.appendRightPhilosopherContent(rightResp, rightNotes);
            Promise.all([leftPromise, rightPromise]).catch(function (err) {
              console.warn("[chatSend] philosopher panels:", err);
            });
            setTimeout(function () {
              var requestLeft = Math.random() < LEFT_PHILOSOPHER_INTERACTION_RATE;
              var requestRight = Math.random() < RIGHT_PHILOSOPHER_INTERACTION_RATE;
              console.log("[DEBUG] Philosopher self-dialog: requestLeft=" + requestLeft + " requestRight=" + requestRight, "(left turns: " + leftPhilosopherHistory.length + ", right turns: " + rightPhilosopherHistory.length + ")");
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
                .then(function (res) { return res.ok ? res.json() : res.json().then(function (j) { throw new Error(j.error || res.statusText); }); })
                .then(function (dialogData) {
                  console.log("[DEBUG] Philosopher dialog response; left content:", !!(dialogData.leftPhilosopherResponse || (Array.isArray(dialogData.leftPhilosopherNotes) && dialogData.leftPhilosopherNotes.length)), " right content:", !!(dialogData.rightPhilosopherResponse || (Array.isArray(dialogData.rightPhilosopherNotes) && dialogData.rightPhilosopherNotes.length)));
                  var dLeftResp = dialogData.leftPhilosopherResponse || "";
                  var dLeftNotes = Array.isArray(dialogData.leftPhilosopherNotes) ? dialogData.leftPhilosopherNotes : [];
                  var dRightResp = dialogData.rightPhilosopherResponse || "";
                  var dRightNotes = Array.isArray(dialogData.rightPhilosopherNotes) ? dialogData.rightPhilosopherNotes : [];
                  if (requestLeft && (dLeftResp || dLeftNotes.length)) {
                    leftPhilosopherHistory.push({ response: dLeftResp, notes: dLeftNotes });
                    EDARules.appendLeftPhilosopherContent(dLeftResp, dLeftNotes).catch(function (err) { console.warn("[chatSend] philosopher dialog left panel:", err); });
                  }
                  if (requestRight && (dRightResp || dRightNotes.length)) {
                    rightPhilosopherHistory.push({ response: dRightResp, notes: dRightNotes });
                    EDARules.appendRightPhilosopherContent(dRightResp, dRightNotes).catch(function (err) { console.warn("[chatSend] philosopher dialog right panel:", err); });
                  }
                })
                .catch(function (err) {
                  console.warn("[chatSend] Philosopher dialog request failed:", err.message);
                });
            }, PHILOSOPHER_SELF_DIALOG_TIME);
          } else {
            leftPhilosopherHistory.push({ response: "", notes: [] });
            rightPhilosopherHistory.push({ response: "", notes: [] });
          }
          if (
            Array.isArray(data.philosopherNotes) &&
            data.philosopherNotes.length > 0
          ) {
            var seq = Promise.resolve();
            data.philosopherNotes.forEach(function (note) {
              if (typeof note !== "string") return;
              seq = seq.then(function () {
                return EDARules.appendPhilosopherNoteToBothPanels(note);
              });
            });
          }
        })
        .catch(function (err) {
          EDAMessageUI.setStatus("Network error: " + err.message, true);
        })
        .finally(onDone);
    }

    EDAMessageUI.addSeparatorLine(runFetch, editorRef);
  }

  global.EDAChatSend = {
    doSendMessage: doSendMessage,
    animateRewriteInInput: animateRewriteInInput,
  };
})(typeof window !== "undefined" ? window : this);
