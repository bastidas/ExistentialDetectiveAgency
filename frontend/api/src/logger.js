"use strict";

const config = require("./config");

/**
 * Shared logger for backend services.
 *
 * Levels:
 * - info / warn / error: always logged.
 * - debug: only when config.DEBUG_LOGS is truthy.
 *
 * Color semantics (when stdout is a TTY):
 * - magenta: user-facing messages or content.
 * - cyan: internal / hidden state.
 * - green: system / developer / LLM prompts and metadata.
 */

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

function baseLog(level, scope, args) {
  const prefixScope = scope ? `[${scope}]` : "[log]";
  const levelLabel = level.toUpperCase();
  const pieces = (args || []).map((arg) => {
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg, null, config.DEBUG_LOGS ? 2 : 0);
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

function debug(scope, ...args) {
  if (!config.DEBUG_LOGS) return;
  baseLog("debug", scope, args);
}

function warn(scope, ...args) {
  baseLog("warn", scope, args);
}

function error(scope, ...args) {
  baseLog("error", scope, args);
}

const LOG_CATEGORY_COLORS = Object.freeze({
  HTTP: ansi.blue,
  STATE: ansi.cyan,
  LLM: ansi.green,
  STORAGE: ansi.yellow,
  UI: ansi.magenta,
});

function category(categoryName, scope, ...args) {
  if (!config.DEBUG_LOGS) return;
  const key = String(categoryName || "").toUpperCase();
  const color = LOG_CATEGORY_COLORS[key] || ansi.dim;
  const tag = `${color}[${key}]${ansi.reset}`;
  baseLog("debug", scope, [tag, ...args]);
}

function state(scope, label, snapshot) {
  if (!config.DEBUG_STATE) return;
  const renderedLabel = `${ansi.cyan}[STATE] ${label}${ansi.reset}`;
  let payload;
  try {
    payload = JSON.stringify(snapshot, null, 2);
  } catch (_) {
    payload = String(snapshot);
  }
  console.log(`${renderedLabel}\n${payload}`);
}

/**
 * Logs a user-visible message (e.g. what the detective says to the user).
 * Uses magenta to distinguish from internal state.
 */
function logUserMessage(scope, text) {
  if (!config.DEBUG_LOGS) return;
  const body = `${ansi.magenta}${text}${ansi.reset}`;
  baseLog("debug", scope, ["User-visible message:", body]);
}

/**
 * Logs internal/hidden state for debugging, pretty-printed and in cyan.
 */
function logInternalState(scope, label, state) {
  if (!config.DEBUG_LOGS) return;
  const header = `${ansi.cyan}${label}${ansi.reset}`;
  let json;
  try {
    json = JSON.stringify(state, null, 2);
  } catch (_) {
    json = String(state);
  }
  console.log(`${header}\n${json}`);
}

/**
 * Logs an LLM call with readable messages and params when DEBUG_LLM is enabled.
 *
 * options: { label?: string, messages?: Array<{ role, content }>, params?: object }
 */
function logLLMCall(scope, options) {
  if (!config.DEBUG_LLM) return;
  const label = options && options.label ? ` (${options.label})` : "";
  console.log(
    `${ansi.dim}${ansi.cyan}--- LLM call: ${scope}${label} ---${ansi.reset}`
  );

  const messages = (options && Array.isArray(options.messages)
    ? options.messages
    : [])
    .filter(Boolean);

  for (const msg of messages) {
    const role = String(msg.role || "unknown");
    let content = msg.content;

    // Handle array content (e.g. tool messages) by concatenating text parts.
    if (Array.isArray(content)) {
      content = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && typeof part.text === "string") {
            return part.text;
          }
          try {
            return JSON.stringify(part);
          } catch (_) {
            return String(part);
          }
        })
        .join("\n");
    }

    if (typeof content !== "string") {
      try {
        content = JSON.stringify(content, null, 2);
      } catch (_) {
        content = String(content);
      }
    }

    let color = ansi.cyan;
    if (role === "system" || role === "developer" || role === "tool") {
      color = ansi.green;
    } else if (role === "user" || role === "assistant") {
      color = ansi.magenta;
    }

    console.log(`${color}${role.toUpperCase()}${ansi.reset}\n${content}`);
  }

  if (options && options.params) {
    let paramsString;
    try {
      paramsString = JSON.stringify(options.params, null, 2);
    } catch (_) {
      paramsString = String(options.params);
    }
    console.log(
      `${ansi.dim}${ansi.cyan}--- LLM params ---${ansi.reset}\n${paramsString}`
    );
  }

  console.log(`${ansi.dim}${ansi.cyan}--- End LLM call ---${ansi.reset}`);
}

module.exports = {
  ansi,
  info,
  debug,
  warn,
  error,
  category,
  state,
  logUserMessage,
  logInternalState,
  logLLMCall,
};
