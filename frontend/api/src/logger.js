"use strict";

/**
 * Shared logger for backend services.
 *
 * Levels:
 * - info / warn / error: always logged.
 * - debug: only when DEBUG_LOGS is truthy.
 * - DEBUG_PROMPTS_LEVEL: 0 = off, 1–2 reserved, 3 = log exact system string (includes schema appendix) + full messages array from LLM calls.
 *
 * Color semantics (when stdout is a TTY):
 * - magenta: user-facing messages or content.
 * - cyan: internal / hidden state.
 * - green: system / developer / LLM prompts and metadata.
 * - yellow: highlights / bins / transitions.
 */

const prettyJson = /^(1|true|yes)$/i.test(process.env.DEBUG_LOGS || "");

/**
 * Structured detective/philosopher system prompts are JSON with `identity` as a long string;
 * pretty-printing the whole blob still escapes newlines in `identity`. Unpack into sections.
 * @param {unknown} parsed
 * @param {{ omitEmptyConversationKeys?: boolean }} [options]
 * @returns {string|null} readable multi-line string, or null if not agent_context
 */
function formatStructuredAgentContextFromObject(parsed, options) {
  if (!parsed || typeof parsed !== "object" || parsed.type !== "agent_context") {
    return null;
  }
  const omitEmpty = !!(options && options.omitEmptyConversationKeys);
  const id = String(parsed.identity ?? "").trim();
  const oa = String(parsed.other_agents ?? "").trim();
  let cs = parsed.conversation_state;
  if (omitEmpty && cs && typeof cs === "object" && !Array.isArray(cs)) {
    /** @type {Record<string, unknown>} */
    const slim = {};
    for (const key of Object.keys(cs)) {
      const v = /** @type {Record<string, unknown>} */ (cs)[key];
      if (v === "" || v == null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      slim[key] = v;
    }
    cs = slim;
  }
  const os = parsed.output_schema;

  const lines = [];
  lines.push("type: agent_context");
  lines.push("");
  lines.push("--- identity (persona, instructions, catalog, custom) ---");
  lines.push(id || "(empty)");
  lines.push("");
  lines.push("--- other_agents ---");
  lines.push(oa || "(empty)");
  lines.push("");
  lines.push("--- conversation_state ---");
  try {
    lines.push(JSON.stringify(cs == null ? {} : cs, null, 2));
  } catch (_) {
    lines.push(String(cs));
  }
  lines.push("");
  lines.push("--- output_schema ---");
  try {
    lines.push(JSON.stringify(os == null ? {} : os, null, 2));
  } catch (_) {
    lines.push(String(os));
  }
  return lines.join("\n");
}

/**
 * @param {string} content — system prompt string (JSON or plain)
 * @param {{ omitEmptyConversationKeys?: boolean }} [options] — e.g. dev preview: hide empty optional `conversation_state` keys
 * @returns {string}
 */
function formatStructuredAgentContextForDebug(content, options) {
  let parsed;
  try {
    parsed = JSON.parse(String(content));
  } catch (_) {
    return String(content);
  }
  const formatted = formatStructuredAgentContextFromObject(parsed, options);
  if (formatted != null) return formatted;
  try {
    return JSON.stringify(parsed, null, 2);
  } catch (_) {
    return String(content);
  }
}

/**
 * @param {string} content
 * @returns {string}
 */
function formatLlmMessageContentForDebug(content) {
  const s = content == null ? "" : String(content);
  if (!s.trim()) return s;
  try {
    const parsed = JSON.parse(s);
    const agentCtx = formatStructuredAgentContextFromObject(parsed, undefined);
    if (agentCtx != null) return agentCtx;
    return JSON.stringify(parsed, null, prettyJson ? 2 : 0);
  } catch (_) {
    return s;
  }
}

const ansi = process.stdout.isTTY
  ? {
      dim: "\x1b[2m",
      cyan: "\x1b[36m",
      blue: "\x1b[34m",
      yellow: "\x1b[33m",
      green: "\x1b[32m",
      magenta: "\x1b[35m",
      red: "\x1b[31m",
      bold: "\x1b[1m",
      reset: "\x1b[0m",
    }
  : {
      dim: "",
      cyan: "",
      blue: "",
      yellow: "",
      green: "",
      magenta: "",
      red: "",
      bold: "",
      reset: "",
    };

/**
 * DEBUG_STATE_LEVEL: 0 = off, 1 = some, 2 = more, 3 = verbose (chat machine / orchestration).
 * Falls back to legacy DEBUG_STATE if DEBUG_STATE_LEVEL is unset.
 */
function getDebugStateLevel() {
  const raw =
    process.env.DEBUG_STATE_LEVEL != null && process.env.DEBUG_STATE_LEVEL !== ""
      ? process.env.DEBUG_STATE_LEVEL
      : process.env.DEBUG_STATE;
  if (raw == null || raw === "") return 0;
  const n = Number(String(raw).trim());
  if (Number.isFinite(n) && n >= 0 && n <= 3) return Math.trunc(n);
  if (/^(1|true|yes)$/i.test(String(raw))) return 1;
  return 0;
}

/**
 * DEBUG_PROMPTS_LEVEL: 0 = off, 1–2 reserved, 3 = log exact strings (see `logComposedPromptFull`, `logFullLlmMessages`).
 */
function getDebugPromptsLevel() {
  const raw = process.env.DEBUG_PROMPTS_LEVEL;
  if (raw == null || raw === "") return 0;
  const n = Number(String(raw).trim());
  if (Number.isFinite(n) && n >= 0 && n <= 3) return Math.trunc(n);
  if (/^(1|true|yes)$/i.test(String(raw))) return 1;
  return 0;
}

/**
 * When DEBUG_PROMPTS_LEVEL >= 3, log the full OpenAI `messages` array (e.g. philosopher calls with history + user).
 * @param {string} scope — e.g. "philosopherCall"
 * @param {string} agentKey — e.g. "lumen" | "umbra"
 * @param {Array<{ role: string, content: string }>} messages
 */
function logFullLlmMessages(scope, agentKey, messages) {
  if (getDebugPromptsLevel() < 3) return;
  const a = ansi;
  const key = agentKey != null ? String(agentKey) : "(unknown)";
  console.log(
    `${a.cyan}[${scope}]${a.reset} ${a.bold}${a.green}full messages (exact strings as sent)${a.reset} ` +
      `${a.dim}agentKey=${a.reset}${a.magenta}${key}${a.reset}`
  );
  const rule = `${a.dim}${"—".repeat(72)}${a.reset}`;
  const list = Array.isArray(messages) ? messages : [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const role = m && m.role != null ? String(m.role) : "?";
    console.log(rule);
    console.log(
      `${a.dim}[${i}]${a.reset} ${a.yellow}role=${role}${a.reset}`
    );
    console.log(m && m.content != null ? String(m.content) : "");
  }
  console.log(rule);
}

/**
 * When DEBUG_PROMPTS_LEVEL >= 3: log the exact system-role string from composeAgentPrompt (includes response-format instructions).
 * @param {{ agentKey: string, activeAgent?: string|null, systemContentExact: string }} input
 */
function logComposedPromptFull({ agentKey, activeAgent, systemContentExact }) {
  if (getDebugPromptsLevel() < 3) return;
  const a = ansi;
  const key = agentKey != null ? String(agentKey) : "(unknown)";
  let header =
    `${a.cyan}[composedPrompt]${a.reset} ${a.bold}${a.green}exact system role string${a.reset} ` +
      `${a.dim}(persona + instructions + catalog + custom + response format)${a.reset} ` +
      `${a.dim}agentKey=${a.reset}${a.magenta}${key}${a.reset}`;
  if (activeAgent != null && String(activeAgent).trim() !== "") {
    header += ` ${a.yellow}activeAgent=${String(activeAgent)}${a.reset}`;
  }
  console.log(header);
  const rule = `${a.dim}${"—".repeat(72)}${a.reset}`;
  console.log(rule);
  console.log(systemContentExact == null ? "" : String(systemContentExact));
  console.log(rule);
}

function baseLog(level, scope, args) {
  const prefixScope = scope ? `[${scope}]` : "[log]";
  const levelLabel = level.toUpperCase();
  const pieces = (args || []).map((arg) => {
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg, null, prettyJson ? 2 : 0);
    } catch (_) {
      return String(arg);
    }
  });
  const line = `${prefixScope} ${levelLabel}: ${pieces.join(" ")}`.trim();

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function info(scope, ...args) {
  baseLog("info", scope, args);
}

function warn(scope, ...args) {
  baseLog("warn", scope, args);
}

function error(scope, ...args) {
  baseLog("error", scope, args);
}

function debug(scope, ...args) {
  if (!/^(1|true|yes)$/i.test(process.env.DEBUG_LOGS || "")) return;
  baseLog("debug", scope, args);
}

/** Optional structured LLM logging (used by summarization and similar). */
function logLLMCall(scope, payload) {
  debug(scope, "LLM call", payload);
}

const a = ansi;

/**
 * Tiered logging for chat XState (DEBUG_STATE_LEVEL 1–3).
 * @param {1|2|3} tier — 1 = summary, 2 = context + envelope, 3 = full snapshot + thresholds
 * @param {string} step — label for this log line group
 * @param {(colors: typeof ansi) => void} write — call console.log with colors inside
 */
function logChatMachineState(tier, step, write) {
  if (getDebugStateLevel() < tier) return;
  const header = `${a.cyan}[chatMachine]${a.reset} ${a.bold}${a.green}${step}${a.reset}`;
  console.log(header);
  write(a);
}

module.exports = {
  ansi,
  baseLog,
  info,
  warn,
  error,
  debug,
  logLLMCall,
  getDebugStateLevel,
  getDebugPromptsLevel,
  logComposedPromptFull,
  logFullLlmMessages,
  logChatMachineState,
  formatStructuredAgentContextForDebug,
  formatStructuredAgentContextFromObject,
};
