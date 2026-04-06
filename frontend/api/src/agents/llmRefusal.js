"use strict";

const logger = require("../logger");

/**
 * OpenAI assistant message may carry `refusal` when the model declines (e.g. Structured Outputs + safety).
 * @param {unknown} message — `choices[0].message`
 * @returns {string|null}
 */
function extractAssistantRefusal(message) {
  if (!message || typeof message !== "object") return null;
  const r = /** @type {{ refusal?: unknown }} */ (message).refusal;
  if (r == null) return null;
  const s = String(r).trim();
  return s.length > 0 ? s : null;
}

/** @type {Record<string, string[]>} */
const ENIGMATIC_USER_LINES = {
  detective: [
    "The detective refuses such enigmatic queries.",
    "The detective seems to have stepped out for a cup of coffee.",
    "The detective studies the ceiling, wordless, and the moment passes.",
    "Whatever you asked, the detective only raises an eyebrow and says nothing.",
    "The agency line crackles; the detective is elsewhere.",
  ],
  attache: [
    "The attaché cannot fathom a response.",
    "The attaché blinks, once, and the words will not come.",
    "The attaché folds the thought away, unfinished.",
    "Silence from the attaché — perhaps the question was too bright.",
  ],
  lumen: [
    "Lumen holds a candle to the thought and finds only shadow.",
    "The lumen voice trails off into a question that answers itself with silence.",
  ],
  umbra: [
    "Umbra declines to speak; the words would be too heavy.",
    "From umbra, only a long exhale and no reply.",
  ],
  default: [
    "The corridor is empty. Whatever was asked, no answer follows.",
    "The typewriter hesitates; the ribbon runs dry.",
  ],
};

/**
 * User-visible line when the model refused (enigmatic, not diagnostic).
 * @param {string} agentKey — `detective` | `attache` | `lumen` | `umbra` | other
 * @returns {string}
 */
function enigmaticRefusalUserLine(agentKey) {
  const k = agentKey != null ? String(agentKey) : "";
  const bucket =
    k === "detective" || k === "attache" || k === "lumen" || k === "umbra" ? k : "default";
  const lines = ENIGMATIC_USER_LINES[bucket] || ENIGMATIC_USER_LINES.default;
  return lines[Math.floor(Math.random() * lines.length)];
}

/**
 * Detailed server log for operators; never shown to the user as-is.
 * @param {object} input
 * @param {string} input.scope — e.g. `detectiveCall`
 * @param {string} input.agentKey
 * @param {string} input.refusalText
 * @param {string} [input.model]
 * @param {string} [input.responseId]
 * @param {string} [input.finishReason]
 */
function logLlmRefusalBackend({
  scope,
  agentKey,
  refusalText,
  model,
  responseId,
  finishReason,
}) {
  const payload = {
    event: "llm_refusal",
    agentKey,
    refusalText,
    model: model != null ? String(model) : undefined,
    responseId: responseId != null ? String(responseId) : undefined,
    finishReason: finishReason != null ? String(finishReason) : undefined,
  };
  logger.warn(scope, JSON.stringify(payload));
}

/**
 * Metadata attached to API success bodies so the browser can log the real refusal in devtools.
 * @param {string} agentKey
 * @param {string} refusalText
 * @param {object} [response] — OpenAI completion response (optional)
 * @returns {{ agentKey: string, refusalText: string, model?: string, responseId?: string }}
 */
function buildLlmRefusalClientPayload(agentKey, refusalText, response) {
  const id = response && typeof response === "object" ? response.id : undefined;
  const model = response && typeof response === "object" ? response.model : undefined;
  /** @type {{ agentKey: string, refusalText: string, model?: string, responseId?: string }} */
  const out = {
    agentKey: String(agentKey),
    refusalText: String(refusalText),
  };
  if (model != null) out.model = String(model);
  if (id != null) out.responseId = String(id);
  return out;
}

module.exports = {
  extractAssistantRefusal,
  enigmaticRefusalUserLine,
  logLlmRefusalBackend,
  buildLlmRefusalClientPayload,
};
