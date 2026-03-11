"use strict";

const fs = require("fs");
const path = require("path");

const SHARED_DIR = __dirname;
const FRONTEND_DIR = path.join(SHARED_DIR, "..");

function resolvePromptsDir() {
  if (process.env.PROMPTS_DIR) {
    const envDir = path.resolve(process.cwd(), process.env.PROMPTS_DIR);
    if (fs.existsSync(envDir)) return envDir;
    if (fs.existsSync(process.env.PROMPTS_DIR)) {
      return path.resolve(process.env.PROMPTS_DIR);
    }
  }
  const apiLocalPrompts = path.resolve(__dirname, "..", "prompts");
  if (fs.existsSync(apiLocalPrompts)) return apiLocalPrompts;
  const candidates = [
    path.join(FRONTEND_DIR, "api", "prompts"),
    path.resolve(process.cwd(), "api", "prompts"),
    path.resolve(process.cwd(), "frontend", "api", "prompts"),
    path.resolve(process.cwd(), "prompts"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return path.resolve(dir);
    } catch (_) {}
  }
  const fallback = path.resolve(FRONTEND_DIR, "api", "prompts");
  if (!fs.existsSync(fallback)) {
    console.warn("[config] PROMPTS_DIR not found; using fallback path:", fallback);
  }
  return fallback;
}

const PROMPTS_DIR = resolvePromptsDir();

// Persona markdown (kept as rich system prompt text)
const DETECTIVE_PERSONA_FILE = path.join(PROMPTS_DIR, "detective_persona.md");
const LUMEN_PERSONA_FILE = path.join(PROMPTS_DIR, "lumen_persona.md");
const UMBRA_PERSONA_FILE = path.join(PROMPTS_DIR, "umbra_persona.md");

// Instruction markdown (agent-specific instructions)
const DETECTIVE_INSTRUCTIONS_FILE = path.join(
  PROMPTS_DIR,
  "detective_instructions.md"
);
const LUMEN_INSTRUCTIONS_FILE = path.join(
  PROMPTS_DIR,
  "lumen_instructions.md"
);
const UMBRA_INSTRUCTIONS_FILE = path.join(
  PROMPTS_DIR,
  "umbra_instructions.md"
);

// Closers / closing behavior
const CLOSERS_FILE =
  process.env.CLOSERS_FILE || path.join(PROMPTS_DIR, "closers.md");
const CLOSING_INSTRUCTIONS_FILE =
  process.env.CLOSING_INSTRUCTIONS_FILE ||
  path.join(PROMPTS_DIR, "closing_instructions.md");

// Phil annotations can still be JSON under prompts (used by dev server logs)
const PHIL_ANNOTATIONS_FILE =
  process.env.PHIL_ANNOTATIONS_FILE ||
  path.join(PROMPTS_DIR, "phil_annotations.json");

// Turn schema files (structured output contracts for each agent)
const DETECTIVE_TURN_SCHEMA_FILE = path.join(
  PROMPTS_DIR,
  "detective_turn.schema.json"
);
const LUMEN_TURN_SCHEMA_FILE = path.join(
  PROMPTS_DIR,
  "lumen_philosopher_turn.schema.json"
);
const UMBRA_TURN_SCHEMA_FILE = path.join(
  PROMPTS_DIR,
  "umbra_philosopher_turn.schema.json"
);

// ---------------------------------------------------------------------------
// Small file helpers
// ---------------------------------------------------------------------------

function loadTextFileOrEmpty(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, "utf8");
      return text.trim();
    }
  } catch (_) {}
  return "";
}

function loadJsonFileOrNull(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    }
  } catch (_) {}
  return null;
}

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const SERVICE_TIER = process.env.OPENAI_SERVICE_TIER || null;
const MAX_HISTORY_LENGTH = 6000; // characters; adjust as needed
const MAX_USER_EXCHANGES = parseInt(process.env.MAX_USER_EXCHANGES, 10) || 5;
const CLOSURE_TURN_THRESHOLD = Math.max(2, MAX_USER_EXCHANGES - 2);
const MAX_DAILY_USAGE = parseInt(process.env.MAX_DAILY_USAGE, 10) || 100;
const DEV = /^(1|true|yes)$/i.test(process.env.DEV || "");
const OFFLINE = /^(1|true|yes)$/i.test(process.env.OFFLINE || "");
const DEBUG_LOGS = /^(1|true|yes)$/i.test(process.env.DEBUG_LOGS || "");

const FRIENDLY_API_KEY_MESSAGE =
  "The keys to this universe are in your hand, but where is the lock?";

const requestOptions =
  SERVICE_TIER === "flex" ? { timeout: 15 * 60 * 1000 } : undefined;

// ---------------------------------------------------------------------------
// Load prompts and schemas from files
// ---------------------------------------------------------------------------

const detectivePersona = loadTextFileOrEmpty(DETECTIVE_PERSONA_FILE);
const lumenPersona = loadTextFileOrEmpty(LUMEN_PERSONA_FILE);
const umbraPersona = loadTextFileOrEmpty(UMBRA_PERSONA_FILE);

const detectiveInstructions = loadTextFileOrEmpty(DETECTIVE_INSTRUCTIONS_FILE);
const lumenInstructions = loadTextFileOrEmpty(LUMEN_INSTRUCTIONS_FILE);
const umbraInstructions = loadTextFileOrEmpty(UMBRA_INSTRUCTIONS_FILE);

const closingInstructions = loadTextFileOrEmpty(CLOSING_INSTRUCTIONS_FILE);

const detectiveClosureRule = `
System note: You receive a conversation_state object each turn.
If conversation_state.should_begin_closure is true or
conversation_state.mode === "closure", gently encourage the user
to wrap up the conversation, offering a reflective closing
question or summary.`;

const agentPrompts = {
  detective: {
    self: [
      detectivePersona,
      detectiveInstructions,
      detectiveClosureRule,
    ]
      .filter(Boolean)
      .join("\n\n"),
    others: [
      "The Lumen Philosopher is warm, metaphorical, and hopeful.",
      "The Umbra Philosopher is sharp, cynical, and wounded.",
    ].join(" \n"),
  },

  lumen: {
    self: [lumenPersona, lumenInstructions].filter(Boolean).join("\n\n"),
    others: [
      "The Detective is analytical and speaks only to the user.",
      "The Umbra Philosopher is dry, logical, and skeptical of hope.",
    ].join(" \n"),
  },

  umbra: {
    self: [umbraPersona, umbraInstructions].filter(Boolean).join("\n\n"),
    others: [
      "The Detective is grounded and speaks only to the user.",
      "The Lumen Philosopher is hopeful and metaphorical.",
    ].join(" \n"),
  },

  final_detective: {
    self: [detectivePersona, closingInstructions]
      .filter(Boolean)
      .join("\n\n"),
    others: "",
  },
};

const agentSchemas = {
  detective: loadJsonFileOrNull(DETECTIVE_TURN_SCHEMA_FILE),
  lumen: loadJsonFileOrNull(LUMEN_TURN_SCHEMA_FILE),
  umbra: loadJsonFileOrNull(UMBRA_TURN_SCHEMA_FILE),
  final_detective: loadJsonFileOrNull(DETECTIVE_TURN_SCHEMA_FILE),
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  PROMPTS_DIR,
  DETECTIVE_PERSONA_FILE,
  LUMEN_PERSONA_FILE,
  UMBRA_PERSONA_FILE,
  DETECTIVE_INSTRUCTIONS_FILE,
  LUMEN_INSTRUCTIONS_FILE,
  UMBRA_INSTRUCTIONS_FILE,
  CLOSERS_FILE,
  CLOSING_INSTRUCTIONS_FILE,
  PHIL_ANNOTATIONS_FILE,
  MODEL,
  SERVICE_TIER,
  MAX_HISTORY_LENGTH,
  MAX_USER_EXCHANGES,
  CLOSURE_TURN_THRESHOLD,
  MAX_DAILY_USAGE,
  DEV,
  OFFLINE,
  DEBUG_LOGS,
  FRIENDLY_API_KEY_MESSAGE,
  requestOptions,
  agentPrompts,
  agentSchemas,
};
