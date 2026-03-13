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

const config = require("./config");

const ATTACHE_PERSONA_FILE = path.join(
  __dirname,
  "testOrchestration",
  "attache_persona.md"
);
const ATTACHE_INSTRUCTIONS_FILE = path.join(
  __dirname,
  "testOrchestration",
  "attache_instructions.md"
);

const ATTACHE_SCHEMA_FILE = path.join(
  __dirname,
  "testOrchestration",
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
  },
  required: ["user_response", "user_intends_explore", "user_intends_close"],
  additionalProperties: false,
};

/** ANSI colors for TTY; empty strings when not a TTY (e.g. piped) so logs stay plain. */
const ansi = process.stdout.isTTY
  ? {
      dim: "\x1b[2m",
      cyan: "\x1b[36m",
      yellow: "\x1b[33m",
      green: "\x1b[32m",
      magenta: "\x1b[35m",
      bold: "\x1b[1m",
      reset: "\x1b[0m",
    }
  : { dim: "", cyan: "", yellow: "", green: "", magenta: "", bold: "", reset: "" };

/**
 * Formats the current attaché input state at this turn for logging (state of the input at this moment).
 *
 * @param {object} input - Attaché input for this turn
 * @returns {string} Log-friendly representation of input state
 */
function formatInputStateAtTurn(input) {
  const n = input.chat_history?.length ?? 0;
  const lines = [
    `${ansi.dim}${ansi.cyan}--- Input state at this turn ---${ansi.reset}`,
    `${ansi.yellow}question_at_hand${ansi.reset}: ${JSON.stringify(input.question_at_hand ?? null)}`,
    `${ansi.yellow}phase_instructions${ansi.reset}: ${JSON.stringify(input.phase_instructions)}`,
    `${ansi.yellow}is_phase_start${ansi.reset}: ${input.is_phase_start}`,
    `${ansi.yellow}next_phase_instructions${ansi.reset}: ${JSON.stringify(input.next_phase_instructions ?? null)}`,
    `${ansi.yellow}chat_history${ansi.reset}: ${n} message(s)`,
  ];
  if (input.turn_instruction != null) {
    lines.splice(lines.length - 1, 0, `${ansi.yellow}turn_instruction${ansi.reset}: ${JSON.stringify(input.turn_instruction)}`);
  }
  lines.push(`${ansi.dim}${ansi.cyan}---------------------${ansi.reset}`);
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

function createAttacheCall(openai, { userMessage }) {
  return async function callAttache(input) {
    console.log(formatInputStateAtTurn(input));
    const instructionForTurn = input.turn_instruction ?? input.phase_instructions;
    const hasFullTurnInstruction = input.turn_instruction != null;
    const turnInstructionsBlock = hasFullTurnInstruction
      ? ["Instructions for this turn:", "", instructionForTurn].join("\n")
      : [
          "Instructions for this turn:",
          instructionForTurn,
          "",
          `# Question to present to the user (if any): ${input.question_at_hand ?? "(none)"}`,
          `# Is this the first question of this phase? ${input.is_phase_start}`,
          "",
          `# If the user is about to transition (e.g. "ready for baseline", "end session"), use these next-phase instructions for your reply: ${input.next_phase_instructions ?? "(none)"}`,
        ].join("\n");


    const parts = [attachePersona, attacheInstructions, turnInstructionsBlock].filter(Boolean);
    const systemContent = parts.join("\n\n");

    console.log(`${ansi.dim}${ansi.cyan}--- System / developer role message (full) ---${ansi.reset}\n${systemContent}\n${ansi.dim}${ansi.cyan}--- End system message ---${ansi.reset}`);

    const historyBlock = Array.isArray(input.chat_history) && input.chat_history.length > 0
      ? input.chat_history.map((m) => `${m.role}: ${m.content}`).join("\n")
      : "(no history yet)";
    const userContent = `${historyBlock}\n\nUser (latest): ${userMessage}`;

    const messages = [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ];

    const params = {
      model: config.MODEL,
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

    if (config.OFFLINE) {
      console.warn("[attacheCall] OFFLINE=1 (or true/yes) in env; returning stub instead of calling OpenAI.");
      return {
        user_response: "[OFFLINE] Attaché stub.",
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
    let out = { user_response: "", user_intends_explore: false, user_intends_close: false };
    if (typeof content === "string" && content.trim()) {
      try {
        const parsed = JSON.parse(content.trim());
        if (parsed && typeof parsed === "object") {
          out = {
            user_response: typeof parsed.user_response === "string" ? parsed.user_response : "",
            user_intends_explore: !!parsed.user_intends_explore,
            user_intends_close: !!parsed.user_intends_close,
          };
        }
      } catch (_) {}
    }
    console.log(
      `${ansi.dim}${ansi.cyan}--- LLM return ---${ansi.reset}\n` +
        `${ansi.green}${ansi.bold}user_response${ansi.reset}: ${ansi.magenta}${JSON.stringify(out.user_response)}${ansi.reset}\n` +
        `${ansi.green}user_intends_explore${ansi.reset}: ${out.user_intends_explore}\n` +
        `${ansi.green}user_intends_close${ansi.reset}: ${out.user_intends_close}\n` +
        `${ansi.dim}${ansi.cyan}--- End LLM return ---${ansi.reset}`
    );
    return out;
  };
}

module.exports = {
  createAttacheCall,
  ATTACHE_TURN_SCHEMA,
};
