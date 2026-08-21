(function (global) {
  "use strict";

  var STORAGE_KEY = "eda.chat.v1";
  var USER_ID_ECHO_KEY = "eda.userId.echo.v1";
  var SCHEMA_VERSION = 1;
  var MAX_TURNS =
    (global.EDAChatConfig && global.EDAChatConfig.LAST_N_CLIENT_TRANSCRIPT_TURNS) || 100;

  function read() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { schemaVersion: SCHEMA_VERSION, serverSeq: 0, messages: [], userTurns: 0 };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") throw new Error("bad snapshot");
      if (Number(parsed.schemaVersion) !== SCHEMA_VERSION) {
        return { schemaVersion: SCHEMA_VERSION, serverSeq: 0, messages: [], userTurns: 0 };
      }
      parsed.messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      parsed.userTurns = Number(parsed.userTurns || 0);
      parsed.serverSeq = Number(parsed.serverSeq || 0);
      return parsed;
    } catch (_) {
      return { schemaVersion: SCHEMA_VERSION, serverSeq: 0, messages: [], userTurns: 0 };
    }
  }

  function write(snapshot) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (_) {}
  }

  /** When server echo differs from last stored echo, drop local transcript (identity changed). */
  function applyUserIdEchoFromChatState(payload) {
    var echo = payload && payload.edaUserIdEcho;
    if (echo == null || String(echo).trim() === "") return;
    try {
      var prev = global.localStorage.getItem(USER_ID_ECHO_KEY);
      var next = String(echo);
      if (prev != null && prev !== next) {
        global.localStorage.removeItem(STORAGE_KEY);
      }
      global.localStorage.setItem(USER_ID_ECHO_KEY, next);
    } catch (_) {}
  }

  function trimToLastNTurns(messages) {
    if (!Array.isArray(messages) || !messages.length) return [];
    var turns = 0;
    var i;
    for (i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i] && messages[i].role === "user") {
        turns += 1;
        if (turns >= MAX_TURNS) break;
      }
    }
    return i > 0 ? messages.slice(i) : messages.slice();
  }

  function appendAssistant(arr, text, agent, kind) {
    if (text == null || String(text).trim() === "") return;
    var msg = { role: "assistant", text: String(text) };
    if (agent) msg.agent = agent;
    if (kind) msg.kind = kind;
    arr.push(msg);
  }

  function persistTurn(data, userMessage) {
    if (!data || typeof data !== "object") return;
    var s = read();
    var msgs = Array.isArray(s.messages) ? s.messages.slice() : [];
    if (userMessage != null && String(userMessage).trim()) {
      msgs.push({ role: "user", text: String(userMessage) });
      s.userTurns = Number(s.userTurns || 0) + 1;
    }
    appendAssistant(msgs, data.reply, (data.envelope && data.envelope.active_agent) || "detective");
    appendAssistant(msgs, data.lumenUserResponse, "lumen", "lumen_user");
    appendAssistant(msgs, data.umbraUserResponse, "umbra", "umbra_user");
    s.messages = trimToLastNTurns(msgs);
    if (typeof data.serverSeq === "number") s.serverSeq = data.serverSeq;
    write(s);
  }

  function stripRecoveredFlags(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(function (m) {
      if (!m || typeof m !== "object") return m;
      var o = {};
      for (var k in m) {
        if (Object.prototype.hasOwnProperty.call(m, k) && k !== "recovered") {
          o[k] = m[k];
        }
      }
      return o;
    });
  }

  /**
   * True when merge appended local-only lines marked `recovered` (see mergeChatStatePayload).
   *
   * @param {unknown[]} messages
   * @returns {boolean}
   */
  function hasRecoveredLocalTail(messages) {
    if (!Array.isArray(messages)) return false;
    for (var i = 0; i < messages.length; i += 1) {
      if (messages[i] && messages[i].recovered === true) return true;
    }
    return false;
  }

  function mergeChatStatePayload(data) {
    var payload = data && typeof data === "object" ? data : {};
    applyUserIdEchoFromChatState(payload);
    var s = read();
    var serverMessages = Array.isArray(payload.messages) ? payload.messages : [];
    var merged = serverMessages.slice();
    var serverSeq = Number(payload.serverSeq || 0);
    if (s.serverSeq > serverSeq && Array.isArray(s.messages)) {
      // Always show unsynced recovered tail inline.
      var offset = serverMessages.length;
      for (var i = offset; i < s.messages.length; i += 1) {
        var m = s.messages[i];
        if (!m || typeof m !== "object") continue;
        merged.push({
          role: m.role === "assistant" ? "assistant" : "user",
          text: String(m.text || ""),
          agent: m.agent,
          kind: m.kind,
          recovered: true,
        });
      }
      // Try to sync recovered local transcript to durable server snapshot.
      if (global.fetch) {
        global
          .fetch("/api/chat-sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              clientSeq: s.serverSeq,
              messages: s.messages,
              userTurns: s.userTurns || 0,
            }),
          })
          .then(function (r) {
            return r.json().catch(function () {
              return {};
            });
          })
          .then(function (j) {
            if (!j || j.ok !== true) return;
            var seq = j.serverSeq;
            if (typeof seq !== "number" || !Number.isFinite(seq)) return;
            var snap = read();
            snap.serverSeq = seq;
            snap.messages = trimToLastNTurns(stripRecoveredFlags(snap.messages));
            write(snap);
          })
          .catch(function () {});
      }
    }
    payload.messages = merged;
    if (typeof payload.serverSeq === "number") {
      s.serverSeq = payload.serverSeq;
      if (serverMessages.length) s.messages = trimToLastNTurns(serverMessages.slice());
      write(s);
    }
    return payload;
  }

  if (global.fetch) {
    global
      .fetch("/api/config", { credentials: "same-origin" })
      .then(function (r) {
        return r.json().catch(function () {
          return {};
        });
      })
      .then(function (j) {
        var n = j && j.lastNClientTranscriptTurns;
        if (typeof n === "number" && n >= 1) {
          MAX_TURNS = Math.floor(n);
        }
      })
      .catch(function () {});
  }

  global.EDAChatPersist = {
    persistTurn: persistTurn,
    mergeChatStatePayload: mergeChatStatePayload,
    readSnapshot: read,
    hasRecoveredLocalTail: hasRecoveredLocalTail,
  };
})(typeof window !== "undefined" ? window : this);
