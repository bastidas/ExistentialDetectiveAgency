"use strict";

const config = require("../config");
const { stringifyPacket } = require("./packetRegistry");

const QUERENT_DELIMITER = "\n\n---QUERENT---\n";

/**
 * @param {Record<string, unknown>} packet
 * @param {string} [querentText]
 * @param {string} [agentKey]
 * @returns {string}
 */
function formatUserChannelMessage(packet, querentText, agentKey) {
  const json = stringifyPacket(packet && typeof packet === "object" ? packet : {}, agentKey);
  return `${json}${QUERENT_DELIMITER}${querentText == null ? "" : String(querentText)}`;
}

/**
 * Last N native user/assistant turns. Current utterance must not be in this list.
 * @param {Array<{ role?: string, content?: unknown }>|undefined} chatHistory
 * @returns {Array<{ role: "user"|"assistant", content: string }>}
 */
function sliceNativeHistory(chatHistory) {
  const arr = Array.isArray(chatHistory) ? chatHistory : [];
  const tail = arr.slice(-config.HISTORY_TAIL_TURNS);
  const maxChars = config.HISTORY_TURN_MAX_CHARS;
  /** @type {Array<{ role: "user"|"assistant", content: string }>} */
  const out = [];
  for (const m of tail) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
    if (!role) continue;
    let content = m.content == null ? "" : String(m.content);
    if (content.length > maxChars) content = content.slice(0, maxChars);
    if (!content) continue;
    out.push({ role, content });
  }
  return out;
}

module.exports = {
  QUERENT_DELIMITER,
  formatUserChannelMessage,
  sliceNativeHistory,
};
