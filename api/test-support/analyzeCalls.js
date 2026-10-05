"use strict";

const crypto = require("crypto");

/**
 * Name of the call: the Structured Outputs schema name, or `json_object` for helper calls
 * (summarizer, dossier analyzer).
 *
 * @param {{ response_format?: { type?: string, json_schema?: { name?: string } } }} body
 * @returns {string}
 */
function classifyCall(body) {
  const rf = (body && body.response_format) || {};
  if (rf.json_schema && rf.json_schema.name) return String(rf.json_schema.name);
  return rf.type ? String(rf.type) : "unknown";
}

/**
 * @param {unknown} content
 * @returns {number}
 */
function contentLength(content) {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce((n, part) => n + (part && typeof part.text === "string" ? part.text.length : 0), 0);
  }
  return 0;
}

const MOCK_MARKER = /\[mock\b|placeholder for reusable|replace with real content/i;

/**
 * Group recorded chat-completion request bodies by call name and compute the facts that matter for
 * prompt-envelope work: how many calls, whether the system prompt is stable, how big payloads are,
 * and what the role sequence looks like.
 *
 * @param {Array<{ messages?: Array<{ role: string, content: unknown }> }>} requests
 */
function summarizeCalls(requests) {
  /** @type {Record<string, object[]>} */
  const groups = {};
  for (const body of requests) {
    const name = classifyCall(body);
    (groups[name] = groups[name] || []).push(body);
  }
  /** @type {Record<string, object>} */
  const byCall = {};
  for (const [name, bodies] of Object.entries(groups)) {
    const systems = bodies.map((b) => {
      const first = (b.messages || [])[0];
      return first && first.role === "system" ? String(first.content ?? "") : "";
    });
    const distinct = new Set(systems.map((s) => crypto.createHash("sha1").update(s).digest("hex")));
    const systemLens = systems.map((s) => s.length);
    const totals = bodies.map((b) => (b.messages || []).reduce((n, m) => n + contentLength(m.content), 0));
    const rolePatterns = [
      ...new Set(bodies.map((b) => (b.messages || []).map((m) => m.role[0]).join(""))),
    ];
    byCall[name] = {
      calls: bodies.length,
      distinctSystemPrompts: distinct.size,
      systemChars: { min: Math.min(...systemLens), max: Math.max(...systemLens) },
      payloadChars: { first: totals[0], last: totals[totals.length - 1] },
      rolePatterns,
      systemHasMockText: systems.some((s) => MOCK_MARKER.test(s)),
    };
  }
  return { totalCalls: requests.length, byCall };
}

/**
 * @param {ReturnType<typeof summarizeCalls>} summary
 * @param {number} [userTurns]
 * @returns {string} markdown table
 */
function formatReport(summary, userTurns) {
  const lines = [];
  lines.push("| call | calls | distinct system prompts | system chars (min..max) | payload chars (first..last) | role patterns | mock text |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const [name, s] of Object.entries(summary.byCall)) {
    const x = /** @type {any} */ (s);
    lines.push(
      `| ${name} | ${x.calls} | ${x.distinctSystemPrompts} | ${x.systemChars.min}..${x.systemChars.max} | ${x.payloadChars.first}..${x.payloadChars.last} | ${x.rolePatterns.join(", ")} | ${x.systemHasMockText ? "yes" : "no"} |`
    );
  }
  lines.push("");
  const perTurn = userTurns ? ` (${(summary.totalCalls / userTurns).toFixed(2)} per user turn over ${userTurns} turns)` : "";
  lines.push(`Total upstream calls: ${summary.totalCalls}${perTurn}`);
  return lines.join("\n");
}

module.exports = { classifyCall, summarizeCalls, formatReport, MOCK_MARKER };
