"use strict";

const MAX_THREAD_EVENTS = Math.max(20, parseInt(process.env.MAX_THREAD_EVENTS, 10) || 400);
const MAX_THREAD_JSON_CHARS = Math.max(
  20_000,
  parseInt(process.env.MAX_THREAD_JSON_CHARS, 10) || 800_000
);

function trimEvents(events) {
  const arr = Array.isArray(events) ? events.slice() : [];
  if (arr.length > MAX_THREAD_EVENTS) {
    arr.splice(0, arr.length - MAX_THREAD_EVENTS);
  }
  while (arr.length > 0 && JSON.stringify(arr).length > MAX_THREAD_JSON_CHARS) {
    arr.shift();
  }
  return arr;
}

function pushEvent(events, evt) {
  const text = evt && evt.text != null ? String(evt.text) : "";
  if (!text.trim()) return events;
  events.push({
    ts: Date.now(),
    phase: evt.phase === "baseline" ? "baseline" : "detective",
    kind: String(evt.kind || ""),
    text,
    agent: evt.agent ? String(evt.agent) : undefined,
  });
  return events;
}

function appendTurn(events, input) {
  const next = Array.isArray(events) ? events.slice() : [];
  const phase = input && input.phase === "baseline" ? "baseline" : "detective";
  pushEvent(next, { phase, kind: "user", text: input && input.userMessage, agent: "user" });
  pushEvent(next, {
    phase,
    kind: phase === "baseline" ? "attache" : "detective",
    text: input && input.reply,
    agent: phase === "baseline" ? "attache" : "detective",
  });
  pushEvent(next, {
    phase: "detective",
    kind: "lumen_user",
    text: input && input.lumenUserResponse,
    agent: "lumen",
  });
  pushEvent(next, {
    phase: "detective",
    kind: "umbra_user",
    text: input && input.umbraUserResponse,
    agent: "umbra",
  });
  return trimEvents(next);
}

function toChatStateMessages(events) {
  const arr = Array.isArray(events) ? events : [];
  return arr
    .filter((e) => e && typeof e === "object")
    .map((e) => {
      const kind = String(e.kind || "");
      const role = kind === "user" ? "user" : "assistant";
      const msg = {
        role,
        text: String(e.text || ""),
      };
      if (role === "assistant") {
        if (e.agent) msg.agent = String(e.agent);
        else if (kind === "attache") msg.agent = "attache";
        else if (kind === "lumen_user" || kind === "lumen_aside") msg.agent = "lumen";
        else if (kind === "umbra_user" || kind === "umbra_aside") msg.agent = "umbra";
        else msg.agent = "detective";
      }
      if (kind) msg.kind = kind;
      return msg;
    });
}

module.exports = {
  MAX_THREAD_EVENTS,
  MAX_THREAD_JSON_CHARS,
  trimEvents,
  appendTurn,
  toChatStateMessages,
};

