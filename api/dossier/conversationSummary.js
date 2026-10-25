"use strict";

/**
 * Conversation summary: derived state over the append-only chat log.
 *
 * A summary record says which log exchanges it covers, so it can be checked against the log, extended
 * from the uncovered tail, or thrown away and rebuilt:
 *
 *   { v, userId, sessionId, fromSeq, throughSeq, text, createdAt }
 *
 * It is stored in the session row column `conversationSummariesJson` (this session's view) and in the
 * per-user summary row (so a returning visitor with a new session id still has it). Models read it as
 * `preceding_conversation_summary`.
 */

const SUMMARY_SCHEMA_V = 1;

/** Longest summary text kept; the summarizer is asked for a compact memory, this is the backstop. */
const MAX_SUMMARY_TEXT_CHARS = 6_000;

const AGENT_LABEL = Object.freeze({
  user: "Querent",
  attache: "Attaché",
  detective: "Detective",
  lumen_user: "Lumen",
  umbra_user: "Umbra",
});

/**
 * @typedef {{ v: number, userId: string, sessionId: string, fromSeq: number, throughSeq: number, text: string, createdAt: string }} SummaryRecord
 * @typedef {{ seq: number, events: Array<{ kind?: string, text?: string }> }} LogTurn
 */

/**
 * Validate a stored value. Anything that is not a well-formed current-version record (the literal
 * `null` an empty column holds, an older layout, a record with no text) is `null`.
 *
 * @param {unknown} raw — parsed JSON
 * @returns {SummaryRecord|null}
 */
function normalizeSummaryRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (r.v !== SUMMARY_SCHEMA_V) return null;
  if (typeof r.text !== "string" || r.text.trim() === "") return null;
  const fromSeq = Number(r.fromSeq);
  const throughSeq = Number(r.throughSeq);
  if (!Number.isFinite(fromSeq) || !Number.isFinite(throughSeq) || throughSeq < fromSeq || fromSeq < 1) return null;
  return {
    v: SUMMARY_SCHEMA_V,
    userId: typeof r.userId === "string" ? r.userId : "",
    sessionId: typeof r.sessionId === "string" ? r.sessionId : "",
    fromSeq: Math.floor(fromSeq),
    throughSeq: Math.floor(throughSeq),
    text: r.text.slice(0, MAX_SUMMARY_TEXT_CHARS),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

/**
 * @param {string|null|undefined} json
 * @returns {SummaryRecord|null}
 */
function parseSummaryJson(json) {
  if (typeof json !== "string" || json.trim() === "") return null;
  try {
    return normalizeSummaryRecord(JSON.parse(json));
  } catch (_) {
    return null;
  }
}

/**
 * @param {SummaryRecord|null|undefined} record
 * @returns {string} JSON for the column; the literal `null` when there is no summary
 */
function summaryToJson(record) {
  return JSON.stringify(record ? normalizeSummaryRecord(record) : null);
}

/**
 * @param {LogTurn[]} turns
 * @param {SummaryRecord|null} record
 * @returns {LogTurn[]} the exchanges after the ones the summary covers
 */
function uncoveredTurns(turns, record) {
  const list = Array.isArray(turns) ? turns : [];
  const through = record ? record.throughSeq : 0;
  return list.filter((t) => t && Number(t.seq) > through);
}

/**
 * @param {LogTurn[]} turns
 * @returns {string}
 */
function renderTurnsForSummary(turns) {
  const lines = [];
  for (const t of Array.isArray(turns) ? turns : []) {
    for (const e of Array.isArray(t.events) ? t.events : []) {
      const text = e && typeof e.text === "string" ? e.text.trim() : "";
      if (!text) continue;
      const label = AGENT_LABEL[String(e.kind || "")] || "Agent";
      lines.push(`${label}: ${text}`);
    }
  }
  return lines.join("\n");
}

/**
 * Extend `previous` with the exchanges it does not yet cover, once their text is long enough to be
 * worth condensing. Returns `null` when nothing needs doing or the summarizer produced nothing; the
 * caller keeps the old record and the exchanges stay in the log for the next try.
 *
 * @param {object} args
 * @param {LogTurn[]} args.turns — exchanges known for the session, oldest first
 * @param {SummaryRecord|null} args.previous — this session's own summary
 * @param {string} [args.priorText] — a summary carried over from an earlier session, used only when `previous` is null
 * @param {string} args.userId
 * @param {string} args.sessionId
 * @param {number} args.thresholdChars — uncovered text length that triggers a summary
 * @param {(input: string) => Promise<string>} args.summarize
 * @returns {Promise<SummaryRecord|null>}
 */
async function extendSummary({ turns, previous, priorText, userId, sessionId, thresholdChars, summarize }) {
  const tail = uncoveredTurns(turns, previous);
  if (tail.length === 0) return null;
  const tailText = renderTurnsForSummary(tail);
  if (tailText.length < thresholdChars) return null;
  const earlier = previous ? previous.text : String(priorText || "").trim();
  const input = earlier ? `# EARLIER SUMMARY\n${earlier}\n\n# NEW EXCHANGES\n${tailText}` : tailText;
  const text = String((await summarize(input)) || "").trim();
  if (!text) return null;
  const throughSeq = Math.max(...tail.map((t) => Number(t.seq) || 0));
  return {
    v: SUMMARY_SCHEMA_V,
    userId: userId || "",
    sessionId: sessionId || "",
    fromSeq: previous ? previous.fromSeq : Math.max(1, Math.min(...tail.map((t) => Number(t.seq) || 1))),
    throughSeq,
    text: text.slice(0, MAX_SUMMARY_TEXT_CHARS),
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  SUMMARY_SCHEMA_V,
  MAX_SUMMARY_TEXT_CHARS,
  normalizeSummaryRecord,
  parseSummaryJson,
  summaryToJson,
  uncoveredTurns,
  renderTurnsForSummary,
  extendSummary,
};
