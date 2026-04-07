/**
 * Main chat send/receive. API response shapes: `/contracts/chat-http.contract.json`
 * (repo: `frontend/contracts/chat-http.contract.json`).
 */
(function (global) {
  "use strict";
  var uiLog = global.EDALogger || {
    debug: function () {},
    warn: function () {},
    error: function () {},
  };

  var NOTE_DELAY_MS = 40;

  /**
   * Abort /api/chat and /api/chat-stream if the server never responds (e.g. hung upstream).
   * Slightly longer than default server OPENAI_TIMEOUT_MS so the server can return an error body first.
   */
  var CHAT_FETCH_TIMEOUT_MS = 150000;

  /**
   * @param {string} url
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  function fetchChatWithTimeout(url, init) {
    init = init || {};
    var controller = new AbortController();
    var tid = setTimeout(function () {
      controller.abort();
    }, CHAT_FETCH_TIMEOUT_MS);
    var merged = Object.assign({}, init, { signal: controller.signal });
    return fetch(url, merged).finally(function () {
      clearTimeout(tid);
    });
  }

  function chatFetchErrorMessage(err) {
    if (err && err.name === "AbortError") {
      return "Request timed out. Try again.";
    }
    return err && err.message ? String(err.message) : String(err);
  }

  /**
   * Log real LLM refusal text in the browser console (operators). User-visible `reply` stays enigmatic.
   * @param {object} [data]
   */
  function logLlmRefusalFromChatSuccess(data) {
    if (!data || typeof data !== "object" || !data.llmRefusal) return;
    var r = data.llmRefusal;
    var list = Array.isArray(r) ? r : [r];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== "object") continue;
      var agent = item.agentKey != null ? String(item.agentKey) : "";
      var text = item.refusalText != null ? String(item.refusalText) : "";
      var model = item.model != null ? String(item.model) : "";
      var rid = item.responseId != null ? String(item.responseId) : "";
      console.warn("[EDA LLM refusal]", { agentKey: agent, refusalText: text, model: model, responseId: rid });
    }
  }

  /** Panel history keyed by DOM side (lumen → left, umbra → right). */
  var lumenPanelHistory = [];
  var umbraPanelHistory = [];

  // Tracks which agent the next assistant placeholder should be labeled as
  // ("detective" or "attache"). Defaults to detective until the first
  // response envelope arrives or the Attaché intro explicitly sets it.
  var lastActiveAgent = "detective";

  // Tracks baseline → detective handoff so we can trigger the
  // detective's automatic introduction exactly once after the Attaché
  // baseline phase has completed.
  var baselineCompleted = false;
  var detectiveIntroStarted = false;

  /** Prevents double-send when submit fires twice (e.g. easter-egg path or fast double Enter). */
  var sending = false;

  /** Last user message text sent (for applying AI callouts when response arrives). */
  var lastSentUserMessage = "";

  /** Last server-provided row label (`envelope.agent_label`); used for the next outgoing placeholder. */
  var lastAgentLabelFromServer = "";

  /**
   * Visible assistant label: prefer backend `envelope.agent_label`, else EDAChatConfig by `active_agent`.
   * @param {object} [env]
   * @returns {string}
   */
  function assistantLabelFromEnvelope(env) {
    if (!env || typeof env !== "object") {
      env = {};
    }
    if (env.agent_label != null && String(env.agent_label).trim() !== "") {
      return String(env.agent_label).trim();
    }
    var cfg = global.EDAChatConfig || {};
    if (env.active_agent === "attache") {
      return cfg.AGENT_LABEL_ATTACHE || "ATTACHÉ";
    }
    return cfg.AGENT_LABEL_DETECTIVE || cfg.AGENT_CHAT_LABEL || "DETECTIVE";
  }

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

  /**
   * Prefer camelCase lumen/umbra wire keys; fall back to legacy leftPhilosopher* / rightPhilosopher* for one release.
   * @param {object} data
   * @param {string} primary
   * @param {string} [legacy]
   */
  function pickPhilosopherStr(data, primary, legacy) {
    if (!data || typeof data !== "object") return "";
    if (data[primary] != null) return String(data[primary]);
    if (legacy && data[legacy] != null) return String(data[legacy]);
    return "";
  }

  /**
   * @param {object} data
   * @param {string} primary
   * @param {string} [legacy]
   * @returns {string[]}
   */
  function pickPhilosopherNotes(data, primary, legacy) {
    if (!data || typeof data !== "object") return [];
    if (Array.isArray(data[primary])) return data[primary];
    if (legacy && Array.isArray(data[legacy])) return data[legacy];
    return [];
  }

  /** True if any philosopher response/notes field is present. */
  function hasPhilosopherContent(data) {
    return !!(
      data.lumenUserResponse ||
      data.lumenOtherResponse ||
      (Array.isArray(data.lumenNotes) && data.lumenNotes.length > 0) ||
      data.umbraUserResponse ||
      data.umbraOtherResponse ||
      (Array.isArray(data.umbraNotes) && data.umbraNotes.length > 0)
    );
  }

  /** True if the given side has philosopher response or notes (left = lumen, right = umbra). */
  function hasPhilosopherContentForSide(data, side) {
    var s = side === "right" ? "right" : "left";
    if (s === "left") {
      return !!(
        data.lumenUserResponse ||
        data.lumenOtherResponse ||
        (Array.isArray(data.lumenNotes) && data.lumenNotes.length)
      );
    }
    return !!(
      data.umbraUserResponse ||
      data.umbraOtherResponse ||
      (Array.isArray(data.umbraNotes) && data.umbraNotes.length)
    );
  }

  /**
   * Normalize API philosopher fields to lumen* / umbra* (with legacy left/right aliases).
   * Missing keys become "" or [].
   */
  function normalizePhilosopherResponse(data) {
    if (!data || typeof data !== "object") {
      return {
        lumenUserResponse: "",
        umbraUserResponse: "",
        lumenOtherResponse: "",
        umbraOtherResponse: "",
        lumenNotes: [],
        umbraNotes: [],
      };
    }
    return {
      lumenUserResponse: pickPhilosopherStr(data, "lumenUserResponse", "leftPhilosopherUserResponse"),
      umbraUserResponse: pickPhilosopherStr(data, "umbraUserResponse", "rightPhilosopherUserResponse"),
      lumenOtherResponse: pickPhilosopherStr(data, "lumenOtherResponse", "leftPhilosopherOtherResponse"),
      umbraOtherResponse: pickPhilosopherStr(data, "umbraOtherResponse", "rightPhilosopherOtherResponse"),
      lumenNotes: pickPhilosopherNotes(data, "lumenNotes", "leftPhilosopherNotes"),
      umbraNotes: pickPhilosopherNotes(data, "umbraNotes", "rightPhilosopherNotes"),
    };
  }

  /** Normalize to { left, right } for panel append (lumen → left, umbra → right). */
  function toPhilosopherPayload(data) {
    var d = normalizePhilosopherResponse(data);
    function trimStr(s) {
      return typeof s === "string" ? s.trim() : "";
    }
    return {
      left: {
        userResponse: trimStr(d.lumenUserResponse),
        otherResponse: trimStr(d.lumenOtherResponse),
        notes: Array.isArray(d.lumenNotes) ? d.lumenNotes : [],
      },
      right: {
        userResponse: trimStr(d.umbraUserResponse),
        otherResponse: trimStr(d.umbraOtherResponse),
        notes: Array.isArray(d.umbraNotes) ? d.umbraNotes : [],
      },
    };
  }

  /**
   * Apply philosopher response: optionally push to history and append to panels.
   * @param payload - { left: { userResponse, otherResponse, notes }, right: { userResponse, otherResponse, notes } }
   * @param options - pushHistory (push both), or pushHistoryLeft/pushHistoryRight (per-side); appendLeft, appendRight
   */
  function applyPhilosopherResponse(payload, options) {
    var opts = options || {};
    var pushHistory = opts.pushHistory !== false;
    var pushLeft = opts.pushHistoryLeft !== undefined ? opts.pushHistoryLeft : pushHistory;
    var pushRight = opts.pushHistoryRight !== undefined ? opts.pushHistoryRight : pushHistory;
    var appendLeft = opts.appendLeft !== false;
    var appendRight = opts.appendRight !== false;

    if (pushLeft) lumenPanelHistory.push(payload.left);
    if (pushRight) umbraPanelHistory.push(payload.right);

    var promises = [];
    if (appendLeft && (payload.left.userResponse || payload.left.otherResponse || payload.left.notes.length)) {
      promises.push(
        EDARules.appendPhilosopherContent("left", payload.left).catch(function (err) {
          uiLog.warn("UI", "chatSend philosopher left panel", err);
        })
      );
    }
    if (appendRight && (payload.right.userResponse || payload.right.otherResponse || payload.right.notes.length)) {
      promises.push(
        EDARules.appendPhilosopherContent("right", payload.right).catch(function (err) {
          uiLog.warn("UI", "chatSend philosopher right panel", err);
        })
      );
    }
    return Promise.all(promises);
  }

  function handlePhilosopherDialogResponse(dialogData, requestLeft, requestRight) {
    uiLog.debug(
      "UI",
      "Philosopher dialog response content flags",
      hasPhilosopherContentForSide(dialogData, "left"),
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

  function handlePhilosopherContent(data) {
    var normalized = normalizePhilosopherResponse(data);
    if (hasPhilosopherContent(normalized)) {
      var payload = toPhilosopherPayload(normalized);
      applyPhilosopherResponse(payload, { pushHistory: true, appendLeft: true, appendRight: true });
    }
  }

  /**
   * Parse callout entries from API (object { userText, mode } or array [userText, mode]).
   * Returns normalized { userText, mode } or null if invalid.
   */
  function parseCalloutEntry(entry) {
    if (!entry) return null;
    var userText = (entry && typeof entry === "object" && "userText" in entry)
      ? String(entry.userText).trim()
      : (Array.isArray(entry) && entry.length >= 2)
        ? String(entry[0]).trim()
        : "";
    var mode = (entry && typeof entry === "object" && "mode" in entry)
      ? String(entry.mode).toLowerCase()
      : (Array.isArray(entry) && entry.length >= 2)
        ? String(entry[1]).toLowerCase()
        : "";
    if (!userText || !mode) return null;
    if (mode !== "keyword" && mode !== "highlight" && mode !== "strike") return null;
    return { userText: userText, mode: mode };
  }

  /**
   * Build "seen" set from existing applied callouts and DOM spans.
   * Uses exact span text only (plus optional capped subphrases) to avoid O(n²) and keep behavior stable.
   */
  function buildSeenFromAppliedAndSpans(applied, contentEl, options) {
    var opts = options || {};
    var maxSubphrasesPerSpan = typeof opts.maxSubphrasesPerSpan === "number" ? opts.maxSubphrasesPerSpan : 20;
    var seen = {};
    applied.forEach(function (c) {
      var k = (c.userText || "").toLowerCase();
      if (k) seen[k] = true;
    });
    var existingSpans = contentEl ? contentEl.querySelectorAll(".keyword-annotation") : [];
    for (var i = 0; i < existingSpans.length; i++) {
      var t = (existingSpans[i].textContent || "").trim().toLowerCase();
      if (!t) continue;
      seen[t] = true;
      var words = t.split(/\s+/);
      var count = 0;
      for (var start = 0; start < words.length && count < maxSubphrasesPerSpan; start++) {
        for (var end = start; end < words.length && count < maxSubphrasesPerSpan; end++) {
          var sub = words.slice(start, end + 1).join(" ");
          if (sub && !seen[sub]) {
            seen[sub] = true;
            count++;
          }
        }
      }
    }
    return seen;
  }

  /**
   * Apply API callouts to the last user message content.
   * Only mutates the DOM by adding new spans and rough notation; does not replace or reflow existing content.
   * @param data - API response with lumenCallouts / umbraCallouts (legacy: leftPhilosopherCallouts / rightPhilosopherCallouts or snake_case)
   * @param lastSentText - text of the last sent user message (used to verify we're annotating the right node)
   */
  function applyCalloutsToLastUserMessage(data, lastSentText) {
    if (!data || typeof data !== "object") return;
    function pickCallouts(primary, legacy, snake) {
      if (Array.isArray(data[primary])) return data[primary];
      if (legacy && Array.isArray(data[legacy])) return data[legacy];
      if (snake && Array.isArray(data[snake])) return data[snake];
      return [];
    }
    var leftCallouts = pickCallouts("lumenCallouts", "leftPhilosopherCallouts", "lumen_philosopher_callouts");
    var rightCallouts = pickCallouts("umbraCallouts", "rightPhilosopherCallouts", "umbra_philosopher_callouts");
    if (!leftCallouts.length && !rightCallouts.length) return;
    if (!lastSentText || typeof lastSentText !== "string" || !lastSentText.trim()) return;
    if (typeof EDAAnnotation === "undefined" || !EDAAnnotation.addInPlaceAnnotationSpans) return;

    var messagesEl = document.getElementById("messages");
    var userBlocks = messagesEl ? messagesEl.querySelectorAll(".message.user") : [];
    var lastUser = userBlocks.length ? userBlocks[userBlocks.length - 1] : null;
    var content = lastUser ? lastUser.querySelector(".content") : null;
    if (!content) return;

    // Harden: verify this content node corresponds to the last sent message (avoid annotating wrong message).
    var contentText = (content.textContent || "").trim();
    var sentNorm = lastSentText.trim();
    if (contentText.indexOf(sentNorm) === -1 && sentNorm.indexOf(contentText) === -1) {
      return;
    }

    var applied = [];
    try {
      var raw = content.getAttribute("data-applied-callouts") || "[]";
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        applied = parsed.map(function (c) {
          if (c && typeof c === "object" && "userText" in c && "mode" in c) {
            return { userText: String(c.userText).trim(), mode: String(c.mode).toLowerCase() };
          }
          if (Array.isArray(c) && c.length >= 2) {
            return { userText: String(c[0]).trim(), mode: String(c[1]).toLowerCase() };
          }
          return null;
        }).filter(Boolean);
      }
    } catch (e) {}

    var seen = buildSeenFromAppliedAndSpans(applied, content, { maxSubphrasesPerSpan: 20 });
    function addCallout(word, mode) {
      var key = (word || "").trim().toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      applied.push({ userText: (word || "").trim(), mode: (mode || "keyword").toLowerCase() });
    }

    var appliedLengthBefore = applied.length;
    [].concat(leftCallouts, rightCallouts).forEach(function (entry) {
      var c = parseCalloutEntry(entry);
      if (c) addCallout(c.userText, c.mode);
    });
    var newCallouts = applied.slice(appliedLengthBefore);
    if (!newCallouts.length) return;

    var newSpans = [];
    var requestedCount = newCallouts.length;
    newCallouts.forEach(function (c) {
      var spans = EDAAnnotation.addInPlaceAnnotationSpans(content, c.userText, c.mode);
      newSpans.push.apply(newSpans, spans);
    });
    if (newSpans.length < requestedCount && typeof console !== "undefined" && console.warn) {
      uiLog.warn("UI", "annotation applied fewer spans than callouts", newSpans.length, requestedCount);
    }
    if (newSpans.length && EDAAnnotation.applyRoughNotationToSpans) {
      EDAAnnotation.applyRoughNotationToSpans(newSpans, "left");
    }
    content.setAttribute("data-applied-callouts", JSON.stringify(applied));
  }

  /**
   * @param {Object} data - API response
   * @param {HTMLElement} editorRef - Insert ref (unused when placeholderOpts provided)
   * @param {{ placeholderContent: HTMLElement }} [placeholderOpts] - When set, fill this content instead of addMessage
   */
  function handleChatResponse(data, editorRef, placeholderOpts) {
    var envelope = data && data.envelope ? data.envelope : null;
    if (envelope && envelope.active_agent) {
      lastActiveAgent = envelope.active_agent;
    }
    if (envelope) {
      lastAgentLabelFromServer = assistantLabelFromEnvelope(envelope);
    }

    /** Keep visible row label in sync with server (fixes streaming + stale lastActiveAgent). */
    function applyAssistantLabelFromEnvelope() {
      var env = data && data.envelope;
      var hasFollowup =
        data &&
        data.detective_followup_reply &&
        String(data.detective_followup_reply).trim();
      // Chained handoff: first bubble is still Attaché; detective follows in a second bubble.
      var agent = hasFollowup
        ? "attache"
        : env && env.active_agent === "attache"
          ? "attache"
          : "detective";
      var label =
        env && env.agent_label != null && String(env.agent_label).trim() !== ""
          ? String(env.agent_label).trim()
          : assistantLabelFromEnvelope({ active_agent: agent });
      if (placeholderOpts && placeholderOpts.placeholderLabelEl) {
        var el = placeholderOpts.placeholderLabelEl;
        el.className =
          agent === "attache" ? "label label--attache" : "label label--detective";
        el.textContent = label;
      }
    }
    applyAssistantLabelFromEnvelope();

    var nowBaselineCompleted = !!(envelope && envelope.baseline_completed === true);
    var isBaselineMode = !nowBaselineCompleted;

    // Sync random margin items mode with the current chat mode so
    // baseline-only objects can actually be selected and dropped.
    if (global.EDARandomMarginItems && typeof global.EDARandomMarginItems.setMode === "function") {
      global.EDARandomMarginItems.setMode(isBaselineMode ? "baseline" : "normal");
    }
    if (nowBaselineCompleted) {
      baselineCompleted = true;
    }
    var shouldStartDetectiveIntroAfterThis = isBaselineMode && nowBaselineCompleted && !detectiveIntroStarted;
    if (data && data.dossierUpdated && global.EDAClosingStamps && typeof global.EDAClosingStamps.showDossierStamp === "function") {
      global.EDAClosingStamps.showDossierStamp();
    }
    if (!data.reply && data.error) {
      var displayMsg = chatErrorToMessage(data);
      EDAMessageUI.setStatus(displayMsg, true);
      if (placeholderOpts && placeholderOpts.placeholderContent) {
        placeholderOpts.placeholderContent.textContent = displayMsg;
      } else {
        EDAMessageUI.addMessage("assistant", displayMsg, editorRef);
      }
      return;
    }
    EDAMessageUI.setStatus("");
    logLlmRefusalFromChatSuccess(data);
    if (data.debug) {
      uiLog.debug(
        "UI",
        "user exchanges",
        data.debug.userExchanges + "/" + data.debug.maxUserExchanges
      );
      uiLog.debug(
        "UI",
        "daily usage",
        data.debug.dailyUsage + "/" + data.debug.maxDailyUsage
      );
    }
    var philNormalized = normalizePhilosopherResponse(data);
    uiLog.debug("UI", "Main chat response philosopher fields present", hasPhilosopherContent(philNormalized));

    var atLimit = data.debug && typeof data.debug.userExchanges === "number" && typeof data.debug.maxUserExchanges === "number" && data.debug.userExchanges >= data.debug.maxUserExchanges;
    var stampOpts = {
      limitReached: !!(data && (data.closureUltimate || data.limitReached)),
      debug: !!(document.body && document.body.dataset.devMode === "true") && atLimit,
    };
    var leftHasContent = hasPhilosopherContentForSide(philNormalized, "left");
    var rightHasContent = hasPhilosopherContentForSide(philNormalized, "right");
    var marginItemSideHint = (leftHasContent && !rightHasContent) ? "left" : (rightHasContent && !leftHasContent) ? "right" : null;
    function startDetectiveIntro() {
      if (detectiveIntroStarted) {
        if (EDAMessageUI.runReadyForNextInput) {
          EDAMessageUI.runReadyForNextInput();
        }
        return;
      }
      detectiveIntroStarted = true;

      var editorRefLocal = EDAMessageUI.getEditorNode && EDAMessageUI.getEditorNode();
      var wrapperLocal = editorRefLocal && editorRefLocal.parentNode;
      if (wrapperLocal) wrapperLocal.classList.add("chat-editor-wrapper--hidden");

      var placeholder = EDAMessageUI.addAssistantPlaceholder && EDAMessageUI.addAssistantPlaceholder(editorRefLocal);
      if (!placeholder) {
        if (EDAMessageUI.runReadyForNextInput) {
          EDAMessageUI.runReadyForNextInput();
        }
        return;
      }

      EDAMessageUI.setStatus("Thinking…");

      fetchChatWithTimeout("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message: "" }),
      })
        .then(function (res) {
          if (res.status === 204) {
            if (placeholder && placeholder.node) placeholder.node.remove();
            EDAMessageUI.setStatus("");
            if (EDAMessageUI.runReadyForNextInput) {
              EDAMessageUI.runReadyForNextInput();
            }
            return null;
          }
          return res.json().catch(function () { return {}; });
        })
        .then(function (data2) {
          if (!data2) return;
          logLlmRefusalFromChatSuccess(data2);
          if (!data2.reply && data2.error) {
            var msg = chatErrorToMessage(data2);
            EDAMessageUI.setStatus(msg, true);
            if (placeholder && placeholder.contentEl) {
              placeholder.contentEl.textContent = msg;
            }
            if (EDAMessageUI.runReadyForNextInput) {
              EDAMessageUI.runReadyForNextInput();
            }
            return;
          }

          // Let the server decide which agent is active for this
          // automatic intro turn, then set both the label and the
          // active-agent state based on envelope.active_agent.
          var agent2 = (data2.envelope && data2.envelope.active_agent) ? data2.envelope.active_agent : "detective";
          var label2 = assistantLabelFromEnvelope(data2.envelope || { active_agent: agent2 });
          if (placeholder && placeholder.labelEl) {
            if (global.EDAUtils && global.EDAUtils.typeLabelIntoElement) {
              global.EDAUtils.typeLabelIntoElement(placeholder.labelEl, label2, { delayMs: 60 });
            } else {
              placeholder.labelEl.textContent = label2;
            }
          }
          if (global.EDAChatSend && typeof global.EDAChatSend.setActiveAgent === "function") {
            global.EDAChatSend.setActiveAgent(agent2);
          }

          if (placeholder && placeholder.contentEl) {
            placeholder.contentEl.textContent = data2.reply || "(No reply)";
          }
          EDAMessageUI.setStatus("");
          if (EDAMessageUI.runReadyForNextInput) {
            EDAMessageUI.runReadyForNextInput();
          }
        })
        .catch(function (err) {
          var msg = "Network error: " + chatFetchErrorMessage(err);
          EDAMessageUI.setStatus(msg, true);
          if (placeholder && placeholder.contentEl) {
            placeholder.contentEl.textContent = msg;
          }
          if (EDAMessageUI.runReadyForNextInput) {
            EDAMessageUI.runReadyForNextInput();
          }
        });
    }

    var onAssistantDone = function () {
      if (global.EDAClosingStamps && typeof global.EDAClosingStamps.maybeShowStamps === "function") {
        if (stampOpts.limitReached) global.EDAClosingStamps.maybeShowStamps({ limitReached: true });
        else if (stampOpts.debug) global.EDAClosingStamps.maybeShowStamps({ debug: true });
      }
      var followup =
        data && data.detective_followup_reply && String(data.detective_followup_reply).trim();
      if (followup) {
        detectiveIntroStarted = true;
        lastActiveAgent = "detective";
        if (global.EDAChatSend && typeof global.EDAChatSend.setActiveAgent === "function") {
          global.EDAChatSend.setActiveAgent("detective");
        }
        var editorRefFollow = EDAMessageUI.getEditorNode && EDAMessageUI.getEditorNode();
        EDAMessageUI.addMessage("assistant", followup, editorRefFollow, {
          assistantAgent: "detective",
          assistantLabel: assistantLabelFromEnvelope({ active_agent: "detective" }),
          onAssistantDone: function () {
            if (EDAMessageUI.runReadyForNextInput) {
              EDAMessageUI.runReadyForNextInput();
            }
          },
        });
        return;
      }
      if (shouldStartDetectiveIntroAfterThis) {
        startDetectiveIntro();
      } else if (EDAMessageUI.runReadyForNextInput) {
        EDAMessageUI.runReadyForNextInput();
      }
    };
    if (placeholderOpts && placeholderOpts.placeholderContent) {
      var contentEl = placeholderOpts.placeholderContent;
      if (placeholderOpts.skipAssistantContent) {
        // Streaming path: deltas append chunk-by-chunk. If the server sent no
        // delta events (only a final JSON body), the placeholder is still empty — fill from reply.
        var streamedLen = (contentEl.textContent || "").trim().length;
        if (!streamedLen && data.reply) {
          contentEl.textContent = data.reply;
        }
        onAssistantDone();
      } else if (EDAUtils && EDAUtils.animateAssistantText) {
        EDAUtils.animateAssistantText(contentEl, data.reply || "(No reply)", { onDone: onAssistantDone });
      } else {
        contentEl.textContent = data.reply || "(No reply)";
        onAssistantDone();
      }
    } else {
      var hasFollowupBubble =
        data && data.detective_followup_reply && String(data.detective_followup_reply).trim();
      var agFromEnv = hasFollowupBubble
        ? "attache"
        : envelope && envelope.active_agent === "attache"
          ? "attache"
          : "detective";
      EDAMessageUI.addMessage("assistant", data.reply || "(No reply)", editorRef, {
        onAssistantDone: onAssistantDone,
        assistantAgent: agFromEnv,
        assistantLabel: assistantLabelFromEnvelope(envelope || { active_agent: agFromEnv }),
      });
    }
    handlePhilosopherContent(data);

    // Apply philosopher callouts (for annotations) directly from the
    // main chat response, which now includes per-side callout arrays.
    applyCalloutsToLastUserMessage(data, lastSentUserMessage);

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
    lastSentUserMessage = messageToSend;
    if (EDAMessageUI.removeQuerentIntroIfPresent) {
      EDAMessageUI.removeQuerentIntroIfPresent();
    }
    // Always add user message via addMessage so it gets annotated (keyword/highlight/strike).
    EDAMessageUI.addMessage("user", messageToSend);
    // Trigger a random margin object drop as soon as the user sends input.
    if (global.EDARandomMarginItems && typeof global.EDARandomMarginItems.maybeDropRandomItemForUserInput === "function") {
      global.EDARandomMarginItems.maybeDropRandomItemForUserInput({});
    }
    if (EDAChatInput && EDAChatInput.clear && !deferInputClear) {
      EDAChatInput.clear();
    }
    if (submitBtn) submitBtn.disabled = true;
    EDAMessageUI.setStatus("Thinking…");

    var wrapper = editorRef && editorRef.parentNode;
    if (wrapper) wrapper.classList.add("chat-editor-wrapper--hidden");

    var agentLabel =
      (lastAgentLabelFromServer && String(lastAgentLabelFromServer).trim()) ||
      assistantLabelFromEnvelope({ active_agent: lastActiveAgent });
    var placeholder = EDAMessageUI.addAssistantPlaceholder && EDAMessageUI.addAssistantPlaceholder(editorRef);
    if (placeholder) {
      if (placeholder.labelEl) {
        placeholder.labelEl.className =
          lastActiveAgent === "attache" ? "label label--attache" : "label label--detective";
      }
      if (EDAUtils && EDAUtils.typeLabelIntoElement) {
        EDAUtils.typeLabelIntoElement(placeholder.labelEl, agentLabel, { delayMs: 60 });
      } else {
        placeholder.labelEl.textContent = agentLabel;
      }
    }

    function onDone() {
      sending = false;
      if (submitBtn) submitBtn.disabled = false;
    }

    function runFetch() {
      uiLog.debug("HTTP", "Sending main chat request", messageToSend ? "(message length: " + messageToSend.length + ")" : "");
      var payload = { message: messageToSend };
      // Prefer streaming endpoint in local dev; fall back to JSON /api/chat
      // if streaming is unavailable (404 or missing ReadableStream).

      function runJsonFallback() {
        return fetchChatWithTimeout("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        })
          .then(function (res) {
            if (res.status === 204) {
              if (placeholder && placeholder.node) placeholder.node.remove();
              EDAMessageUI.setStatus("");
              if (global.EDAClosingStamps && typeof global.EDAClosingStamps.maybeShowStamps === "function") {
                global.EDAClosingStamps.maybeShowStamps({ noReply: true });
              }
              if (EDAMessageUI.runReadyForNextInput) {
                EDAMessageUI.runReadyForNextInput();
              }
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
              if (placeholder && placeholder.contentEl) {
                placeholder.contentEl.textContent = msg;
              } else {
                EDAMessageUI.addMessage("assistant", msg, editorRef);
              }
              if (EDAMessageUI.runReadyForNextInput) {
                EDAMessageUI.runReadyForNextInput();
              }
              return;
            }
            var opts = placeholder && placeholder.contentEl
              ? {
                  placeholderContent: placeholder.contentEl,
                  placeholderLabelEl: placeholder.labelEl,
                }
              : undefined;
            handleChatResponse(data, editorRef, opts);
          });
      }

      function runStreaming() {
        return fetchChatWithTimeout("/api/chat-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        })
          .then(function (res) {
            if (res.status === 404 || !res.body || !res.body.getReader) {
              // No streaming support; fall back to JSON endpoint.
              throw { __streamFallback: true };
            }
            if (res.status === 204) {
              if (placeholder && placeholder.node) placeholder.node.remove();
              EDAMessageUI.setStatus("");
              if (global.EDAClosingStamps && typeof global.EDAClosingStamps.maybeShowStamps === "function") {
                global.EDAClosingStamps.maybeShowStamps({ noReply: true });
              }
              if (EDAMessageUI.runReadyForNextInput) {
                EDAMessageUI.runReadyForNextInput();
              }
              return null;
            }

            var reader = res.body.getReader();
            var decoder = new TextDecoder("utf-8");
            var buffer = "";
            var finalEvent = null;

            function processBuffer() {
              var index;
              while ((index = buffer.indexOf("\n")) !== -1) {
                var line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                if (!line) continue;
                try {
                  var evt = JSON.parse(line);
                  if (
                    evt.type === "delta" &&
                    (evt.agent === "detective" || evt.agent === "attache") &&
                    placeholder &&
                    placeholder.contentEl
                  ) {
                    placeholder.contentEl.textContent += evt.text || "";
                  } else if (evt.type === "final") {
                    finalEvent = evt;
                  }
                } catch (e) {
                  uiLog.warn("HTTP", "chat-stream failed to parse event", e && e.message);
                }
              }
            }

            function readNext() {
              return reader.read().then(function (result) {
                if (result.done) {
                  processBuffer();
                  return;
                }
                buffer += decoder.decode(result.value, { stream: true });
                processBuffer();
                return readNext();
              });
            }

            return readNext().then(function () {
              if (!finalEvent) return;
              var status = typeof finalEvent.status === "number" ? finalEvent.status : 200;
              var body = finalEvent.body || {};
              if (status === 204) {
                if (placeholder && placeholder.node) placeholder.node.remove();
                EDAMessageUI.setStatus("");
                if (global.EDAClosingStamps && typeof global.EDAClosingStamps.maybeShowStamps === "function") {
                  global.EDAClosingStamps.maybeShowStamps({ noReply: true });
                }
                if (EDAMessageUI.runReadyForNextInput) {
                  EDAMessageUI.runReadyForNextInput();
                }
                return;
              }
              if (status !== 200 || (!body.reply && body.error)) {
                var msg = chatErrorToMessage(body);
                EDAMessageUI.setStatus(msg, true);
                if (placeholder && placeholder.contentEl) {
                  placeholder.contentEl.textContent = msg;
                } else {
                  EDAMessageUI.addMessage("assistant", msg, editorRef);
                }
                if (EDAMessageUI.runReadyForNextInput) {
                  EDAMessageUI.runReadyForNextInput();
                }
                return;
              }
              var opts = placeholder && placeholder.contentEl
                ? {
                    placeholderContent: placeholder.contentEl,
                    placeholderLabelEl: placeholder.labelEl,
                    skipAssistantContent: true,
                  }
                : { skipAssistantContent: true };
              handleChatResponse(body, editorRef, opts);
            });
          });
      }

      runStreaming()
        .catch(function (err) {
          if (err && err.__streamFallback) {
            return runJsonFallback();
          }
          var netMsg = "Network error: " + chatFetchErrorMessage(err);
          EDAMessageUI.setStatus(netMsg, true);
          if (placeholder && placeholder.contentEl) {
            placeholder.contentEl.textContent = netMsg;
          }
          if (EDAMessageUI.runReadyForNextInput) {
            EDAMessageUI.runReadyForNextInput();
          }
        })
        .finally(onDone);
    }

    runFetch();
  }

  global.EDAChatSend = {
    doSendMessage: doSendMessage,
    animateRewriteInInput: animateRewriteInInput,
    getAssistantDisplayLabel: assistantLabelFromEnvelope,
    /** @public — used by chat.route bootstrap POST /api/chat */
    logLlmRefusalFromChatSuccess: logLlmRefusalFromChatSuccess,
    setActiveAgent: function (agent) {
      if (agent === "attache" || agent === "detective") {
        lastActiveAgent = agent;
      }
    },
    /** Restore client routing flags after /api/chat-state hydration (reload / new tab). */
    restoreRoutingState: function (opts) {
      if (!opts || typeof opts !== "object") return;
      if (opts.baselineCompleted != null) baselineCompleted = !!opts.baselineCompleted;
      if (opts.detectiveIntroStarted != null) detectiveIntroStarted = !!opts.detectiveIntroStarted;
      if (opts.activeAgent === "attache" || opts.activeAgent === "detective") {
        lastActiveAgent = opts.activeAgent;
      }
      if (opts.agentLabel != null && String(opts.agentLabel).trim()) {
        lastAgentLabelFromServer = String(opts.agentLabel).trim();
      }
    },
  };
})(typeof window !== "undefined" ? window : this);


