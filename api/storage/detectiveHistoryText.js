"use strict";

/**
 * Text form of the detective chat history stored in the session row column `detectiveHistoryText`.
 * One message per line: the role, a tab, then the content as a JSON string, so a message that
 * contains newlines or tabs still round-trips. The writer keeps the newest characters when the text
 * is over its limit, which can cut the first line in half; `parseDetectiveHistoryText` skips any
 * line it cannot read.
 */

/**
 * @param {unknown} history — `[{ role, content }]`
 * @returns {string}
 */
function renderDetectiveHistoryText(history) {
  if (!Array.isArray(history)) return "";
  const lines = [];
  for (const m of history) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
    if (!role || typeof m.content !== "string") continue;
    lines.push(`${role}\t${JSON.stringify(m.content)}`);
  }
  return lines.join("\n");
}

/**
 * @param {unknown} text
 * @returns {Array<{ role: "user"|"assistant", content: string }>}
 */
function parseDetectiveHistoryText(text) {
  if (typeof text !== "string" || text === "") return [];
  const out = [];
  for (const line of text.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const role = line.slice(0, tab);
    if (role !== "user" && role !== "assistant") continue;
    try {
      const content = JSON.parse(line.slice(tab + 1));
      if (typeof content === "string") out.push({ role, content });
    } catch (_) {
      /* a line cut by truncation */
    }
  }
  return out;
}

module.exports = { renderDetectiveHistoryText, parseDetectiveHistoryText };
