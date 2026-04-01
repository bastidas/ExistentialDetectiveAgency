"use strict";

const config = require("../config");

const THREAD_EVENT_VERSION = 1;

/**
 * @typedef {{ ts: string, phase: string, kind: string, text: string, v?: number }} ThreadEvent
 */

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {object} session
 * @param {{ phase: 'baseline'|'detective', kind: string, text: string }} ev
 */
function appendThreadEvent(session, ev) {
  if (!session || !ev || !ev.kind) return;
  const text = ev.kind === "user" ? String(ev.text || "").trim() : String(ev.text || "");
  if (ev.kind === "user" && !text) return;
  if (!session.threadEvents) session.threadEvents = [];
  session.threadEvents.push({
    v: THREAD_EVENT_VERSION,
    ts: nowIso(),
    phase: ev.phase === "detective" ? "detective" : "baseline",
    kind: String(ev.kind),
    text: ev.kind === "user" ? text : String(ev.text || ""),
  });
  capThreadEventsInPlace(session.threadEvents);
}

/**
 * @param {ThreadEvent[]} events
 */
function capThreadEventsInPlace(events) {
  if (!Array.isArray(events)) return;
  const maxN = config.MAX_THREAD_EVENTS;
  if (events.length > maxN) {
    events.splice(0, events.length - maxN);
  }
  // Shrink further if JSON too large
  let json = JSON.stringify(events);
  // Azure Table string properties have a practical upper bound (~64 KiB).
  // Keep below that regardless of env configuration to prevent OutOfRangeInput.
  const maxChars = Math.min(config.MAX_THREAD_JSON_CHARS, 60_000);
  while (json.length > maxChars && events.length > 1) {
    events.shift();
    json = JSON.stringify(events);
  }
}

/**
 * @param {unknown} raw
 * @returns {ThreadEvent[]}
 */
function parseThreadEventsJson(raw) {
  if (raw == null || raw === "") return [];
  let arr;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch (_) {
      return [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  } else {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (!e || typeof e !== "object") continue;
    const kind = String(e.kind || "");
    const phase = e.phase === "detective" ? "detective" : "baseline";
    const text = e.text != null ? String(e.text) : "";
    const ts = typeof e.ts === "string" ? e.ts : nowIso();
    if (kind === "user" && !text.trim()) continue;
    out.push({ v: THREAD_EVENT_VERSION, ts, phase, kind, text });
  }
  capThreadEventsInPlace(out);
  return out;
}

/**
 * Serialize thread events for Table Storage.
 * @param {ThreadEvent[]} events
 */
function serializeThreadEventsForStorage(events) {
  const copy = Array.isArray(events) ? events.slice() : [];
  capThreadEventsInPlace(copy);
  return JSON.stringify(copy);
}

/**
 * Main chat timeline only (user, attaché, detective). Excludes internal philosopher lines.
 * @param {ThreadEvent[]} events
 * @returns {object[]}
 */
function threadEventsToMainChatMessages(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || !e.kind) continue;
    const kind = e.kind;
    const text = e.text != null ? String(e.text) : "";
    if (kind === "user") {
      out.push({ role: "user", text, agent: null, kind: "user" });
      continue;
    }
    if (kind === "attache") {
      out.push({ role: "assistant", text, agent: "attache", kind: "attache" });
      continue;
    }
    if (kind === "detective") {
      out.push({ role: "assistant", text, agent: "detective", kind: "detective" });
      continue;
    }
  }
  return out;
}

/**
 * Recoverable internal philosopher transcript (not shown in main user/detective chat).
 * @param {ThreadEvent[]} events
 * @returns {object[]}
 */
function threadEventsToPhilosopherMessages(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || !e.kind) continue;
    const kind = e.kind;
    const text = e.text != null ? String(e.text) : "";
    if (
      kind === "lumen_user" ||
      kind === "lumen_aside" ||
      kind === "umbra_user" ||
      kind === "umbra_aside"
    ) {
      const agent = kind.startsWith("lumen") ? "lumen" : "umbra";
      out.push({ role: "assistant", text, agent, kind });
    }
  }
  return out;
}

/**
 * Plain-text block of philosopher thread lines for summarization.
 * @param {ThreadEvent[]} events
 */
function threadEventsToPhilosopherTranscriptText(events) {
  const msgs = threadEventsToPhilosopherMessages(events);
  if (!msgs.length) return "";
  const lines = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const label =
      m.kind === "lumen_user"
        ? "LUMEN_USER"
        : m.kind === "lumen_aside"
          ? "LUMEN_ASIDE"
          : m.kind === "umbra_user"
            ? "UMBRA_USER"
            : m.kind === "umbra_aside"
              ? "UMBRA_ASIDE"
              : "PHIL";
    lines.push(`[${label}]: ${m.text}`);
  }
  return lines.join("\n\n");
}

/**
 * Map thread events to client restore messages (full timeline).
 * Prefer {@link threadEventsToMainChatMessages} + {@link threadEventsToPhilosopherMessages} for UI.
 * @param {ThreadEvent[]} events
 * @returns {object[]}
 */
function threadEventsToClientMessages(events) {
  if (!Array.isArray(events) || !events.length) return [];
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || !e.kind) continue;
    const kind = e.kind;
    const text = e.text != null ? String(e.text) : "";
    if (kind === "user") {
      out.push({ role: "user", text, agent: null, kind: "user" });
    } else if (kind === "attache") {
      out.push({ role: "assistant", text, agent: "attache", kind: "attache" });
    } else if (kind === "detective") {
      out.push({ role: "assistant", text, agent: "detective", kind: "detective" });
    } else if (
      kind === "lumen_user" ||
      kind === "lumen_aside" ||
      kind === "umbra_user" ||
      kind === "umbra_aside"
    ) {
      const agent = kind.startsWith("lumen") ? "lumen" : "umbra";
      out.push({ role: "assistant", text, agent, kind });
    }
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {object|null}
 */
function parseConversationSummariesJson(raw) {
  if (raw == null || raw === "") return null;
  let o;
  try {
    o = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  return {
    v: typeof o.v === "number" ? o.v : 1,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
    baselineAttache:
      o.baselineAttache != null ? String(o.baselineAttache) : null,
    userDetective: o.userDetective != null ? String(o.userDetective) : null,
    philosophersInternal:
      o.philosophersInternal != null ? String(o.philosophersInternal) : null,
  };
}

function serializeConversationSummaries(s) {
  if (!s || typeof s !== "object") return JSON.stringify(null);
  return JSON.stringify(s);
}

/**
 * @param {object|null} sessionSummaries
 * @returns {string|null}
 */
function getBaselineAttacheSummaryText(sessionSummaries) {
  if (!sessionSummaries || typeof sessionSummaries !== "object") return null;
  const t = sessionSummaries.baselineAttache;
  if (t == null) return null;
  const s = String(t).trim();
  return s || null;
}

module.exports = {
  THREAD_EVENT_VERSION,
  appendThreadEvent,
  capThreadEventsInPlace,
  parseThreadEventsJson,
  serializeThreadEventsForStorage,
  threadEventsToClientMessages,
  threadEventsToMainChatMessages,
  threadEventsToPhilosopherMessages,
  threadEventsToPhilosopherTranscriptText,
  parseConversationSummariesJson,
  serializeConversationSummaries,
  getBaselineAttacheSummaryText,
};
