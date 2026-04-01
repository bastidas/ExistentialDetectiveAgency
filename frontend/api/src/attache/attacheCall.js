"use strict";

const path = require("path");
const fs = require("fs");

// Load src/.env so OPENAI_MODEL (and OPENAI_API_KEY for callers) are set before config is read
try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (_) {}

/**
 * Baseline orchestrator attaché: implements callAttache(input) with the LLM.
 *
 * The orchestrator calls processTurn(userMessage, state, callAttache).
 * callAttache(input) receives { chat_history, question_at_hand, phase_instructions,
 * is_phase_start, next_phase_instructions, turn_instruction? } and must return
 * { user_response, user_intends_explore, user_intends_close }.
 *
 * To mock the LLM: pass an openai client with a stub chat.completions.create,
 * or replace createAttacheCall with a function that returns a no-op/stub.
 */
const config = require("../config");
const logger = require("../logger");
const { ansi } = logger;

const ATTACHE_PROMPTS_DIR = path.join(config.PROMPTS_DIR, "attache");

const ATTACHE_PERSONA_FILE = path.join(
  ATTACHE_PROMPTS_DIR,
  "attache_persona.md"
);
const ATTACHE_INSTRUCTIONS_FILE = path.join(
  ATTACHE_PROMPTS_DIR,
  "attache_instructions.md"
);

const ATTACHE_SCHEMA_FILE = path.join(
  ATTACHE_PROMPTS_DIR,
  "attache_turn.schema.json"
);

function loadTextFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8").trim();
    }
  } catch (_) {}
  return "";
}

function loadJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    }
  } catch (_) {}
  return null;
}

const attachePersona = loadTextFile(ATTACHE_PERSONA_FILE);
const attacheInstructions = loadTextFile(ATTACHE_INSTRUCTIONS_FILE);

const ATTACHE_TURN_SCHEMA = loadJsonFile(ATTACHE_SCHEMA_FILE) || {
  type: "object",
  properties: {
    user_response: { type: "string", description: "The attaché's reply to the user." },
    user_intends_explore: { type: "boolean", description: "User wants to explore; do not advance question." },
    user_intends_close: { type: "boolean", description: "User wants to end the session." },
    asked_baseline_question: { type: "boolean", description: "True only if the attaché actually printed the current baseline question text this turn, exactly as instructed." },
  },
  required: ["user_response", "user_intends_explore", "user_intends_close", "asked_baseline_question"],
  additionalProperties: false,
};


const OFFLINE_ATTACHE_STUB_RESPONSE = "[OFFLINE] Attaché stub.";

// Label used when serializing prior messages into the user prompt.
// Keeping this as a constant here makes it easy to tweak later
// without touching the rest of the call logic.
const CHAT_HISTORY_HEADER = "# CHAT HISTORY";

const LOG_HEADER_INPUT_STATE = "--- Input state at this turn ---";
const LOG_FOOTER_INPUT_STATE = "---------------------";
const LOG_HEADER_SYSTEM_MESSAGE = "--- System / developer role message (full) ---";
const LOG_FOOTER_SYSTEM_MESSAGE = "--- End system message ---";
const LOG_HEADER_LLM_RETURN = "--- LLM return ---";
const LOG_FOOTER_LLM_RETURN = "--- End LLM return ---";

/**
 * Normalize literal newline escape sequences that occasionally leak out of
 * model text (for example "\\n\\nQuestion?") into actual line breaks.
 * This is intentionally narrow so we do not alter unrelated escape content.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeUserResponseText(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");
}
/**
 * Formats the current attaché input state at this turn for logging (state of the input at this moment).
 *
 * @param {object} input - Attaché input for this turn
 * @returns {string} Log-friendly representation of input state
 */
function formatInputStateAtTurn(input) {
  const n = input.chat_history?.length ?? 0;
  const lines = [
    `${ansi.dim}${ansi.cyan}${LOG_HEADER_INPUT_STATE}${ansi.reset}`,
    `${ansi.yellow}question_at_hand${ansi.reset}: ${JSON.stringify(input.question_at_hand ?? null)}`,
    `${ansi.yellow}phase_instructions${ansi.reset}: ${JSON.stringify(input.phase_instructions)}`,
    `${ansi.yellow}is_phase_start${ansi.reset}: ${input.is_phase_start}`,
    `${ansi.yellow}next_phase_instructions${ansi.reset}: ${JSON.stringify(input.next_phase_instructions ?? null)}`,
    `${ansi.yellow}chat_history${ansi.reset}: ${n} message(s)`,
  ];
  if (input.turn_instruction != null) {
    lines.splice(lines.length - 1, 0, `${ansi.yellow}turn_instruction${ansi.reset}: ${JSON.stringify(input.turn_instruction)}`);
  }
  lines.push(`${ansi.dim}${ansi.cyan}${LOG_FOOTER_INPUT_STATE}${ansi.reset}`);
  return lines.join("\n");
}

/**
 * Returns a callAttache function that the baseline orchestrator can pass to processTurn.
 * Mock point: stub openai.chat.completions.create to avoid real API calls.
 *
 * @param {object} openai - OpenAI client (e.g. from require("openai")({ apiKey }))
 * @param {{ userMessage: string }} options - Current user message for this turn
 * @returns {Promise<{ user_response: string, user_intends_explore: boolean, user_intends_close: boolean }>}
 */
/**
 * Returns a callAttache function that the baseline orchestrator can pass to processTurn.
 * Mock point: stub openai.chat.completions.create to avoid real API calls.
 *
 * @param {object} openai - OpenAI client (e.g. from require("openai")({ apiKey }))
 * @param {{ userMessage: string }} options - Current user message for this turn
 * @returns {Promise<{ user_response: string, user_intends_explore: boolean, user_intends_close: boolean }>}
 */

function createAttacheCall(openai, { userMessage }) {
  return async function callAttache(input) {
    if (config.DEBUG_LOGS) {
      console.log(formatInputStateAtTurn(input));
    }
    // The baseline orchestrator (or other caller) is responsible for
    // constructing a rich, per-turn instruction string in
    // input.turn_instruction that already encodes the current
    // scenario/phase and question wording. Here we simply combine:
    //   1) the static attaché persona
    //   2) the static attaché instructions
    //   3) the dynamic, scenario-specific turn instruction
    const turnInstruction = input && typeof input.turn_instruction === "string"
      ? input.turn_instruction
      : "";
    const composedSystemPrompt =
      input && typeof input.composed_system_prompt === "string"
        ? input.composed_system_prompt
        : "";
    const parts = [attachePersona, attacheInstructions, turnInstruction].filter(Boolean);
    const systemContent = composedSystemPrompt || parts.join("\n\n");

    // Detailed system message dumps were useful during early debugging, but
    // they tend to duplicate logger.logLLMCall output. We now rely on the
    // structured logger instead to reduce console noise.

    const historyBlock = Array.isArray(input.chat_history) && input.chat_history.length > 0
      ? [
          CHAT_HISTORY_HEADER,
          input.chat_history.map((m) => `${m.role}: ${m.content}`).join("\n"),
        ].join("\n")
      : `${CHAT_HISTORY_HEADER}\n(no history yet)`;

    if (config.DEBUG_LLM) {
      console.log(
        `${ansi.dim}${ansi.cyan}--- Attaché chat history being sent to LLM ---${ansi.reset}\n` +
        `${historyBlock}\n` +
        `${ansi.dim}${ansi.cyan}--- End attaché chat history ---${ansi.reset}`
      );
    }
    const userContent = `${historyBlock}\n\nUser (latest): ${userMessage}`;

    const messages = [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ];

    const params = {
      // Attaché can use its own model (ATTACHE_MODEL) or fall back
      // to the shared MODEL when ATTACHE_MODEL is not set.
      model: config.ATTACHE_MODEL,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "attache_turn",
          schema: ATTACHE_TURN_SCHEMA,
          strict: true,
        },
      },
      ...(config.SERVICE_TIER === "flex" && { service_tier: "flex" }),
    };

    logger.logLLMCall("attacheCall", {
      label: "attache_turn",
      messages,
      params,
    });

    if (config.OFFLINE) {
      console.warn("[attacheCall] OFFLINE=1 (or true/yes) in env; returning stub instead of calling OpenAI.");
      return {
        user_response: OFFLINE_ATTACHE_STUB_RESPONSE,
        user_intends_explore: false,
        user_intends_close: false,
      };
    }

    // Mock point: replace openai or stub openai.chat.completions.create to avoid real calls.
    const response = await openai.chat.completions.create(
      params,
      config.requestOptions
    );

    const message = response.choices?.[0]?.message;
    const content = message?.content;
    let out = { user_response: "", user_intends_explore: false, user_intends_close: false, asked_baseline_question: false };
    if (typeof content === "string" && content.trim()) {
      try {
        const parsed = JSON.parse(content.trim());
        if (parsed && typeof parsed === "object") {
          out = {
            user_response:
              typeof parsed.user_response === "string"
                ? normalizeUserResponseText(parsed.user_response)
                : "",
            user_intends_explore: !!parsed.user_intends_explore,
            user_intends_close: !!parsed.user_intends_close,
            asked_baseline_question: !!parsed.asked_baseline_question,
          };
        }
      } catch (_) {}
    }
    // Parsed turn results are available via logger.logLLMCall; avoid
    // printing another large block here to keep logs readable.
    return out;
  };
}

module.exports = {
  createAttacheCall,
  ATTACHE_TURN_SCHEMA,
};
