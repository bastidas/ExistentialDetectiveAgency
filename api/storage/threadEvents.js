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

/** Event kinds the server itself writes (see `appendTurn`); client-synced events must use one of them. */
const SYNCABLE_KINDS = Object.freeze({
  user: { phase: "detective", agent: "user" },
  attache: { phase: "baseline", agent: "attache" },
  detective: { phase: "detective", agent: "detective" },
  lumen_user: { phase: "detective", agent: "lumen" },
  umbra_user: { phase: "detective", agent: "umbra" },
});

/**
 * Turn client-supplied transcript lines into server thread events. Unknown kinds, non-objects,
 * empty text and anything past `maxEvents` are dropped, text is cut to `maxChars`, and the agent
 * and phase are derived from the kind rather than trusted from the client.
 *
 * @param {unknown} messages
 * @param {{ maxEvents: number, maxChars: number }} limits
 * @returns {Array<{ ts: number, phase: string, kind: string, text: string, agent: string }>}
 */
function sanitizeSyncedMessages(messages, limits) {
  const list = Array.isArray(messages) ? messages : [];
  const out = [];
  for (const m of list) {
    if (out.length >= limits.maxEvents) break;
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const kind = role === "user" ? "user" : String(m.kind || "detective");
    const spec = Object.prototype.hasOwnProperty.call(SYNCABLE_KINDS, kind) ? SYNCABLE_KINDS[kind] : null;
    if (!spec) continue;
    if (role === "user" && kind !== "user") continue;
    if (role === "assistant" && kind === "user") continue;
    const text = typeof m.text === "string" ? m.text.slice(0, limits.maxChars) : "";
    if (!text.trim()) continue;
    out.push({ ts: Date.now(), phase: spec.phase, kind, text, agent: spec.agent });
  }
  return out;
}

module.exports = {
  sanitizeSyncedMessages,
  MAX_THREAD_EVENTS,
  MAX_THREAD_JSON_CHARS,
  trimEvents,
  appendTurn,
  toChatStateMessages,
};

