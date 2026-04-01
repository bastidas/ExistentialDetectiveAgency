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
const DETECTIVE_PERSONA_FILE = path.join(PROMPTS_DIR, "detective", "detective_persona.md");
const LUMEN_PERSONA_FILE = path.join(PROMPTS_DIR, "lumen", "lumen_persona.md");
const UMBRA_PERSONA_FILE = path.join(PROMPTS_DIR, "umbra", "umbra_persona.md");

// Instruction markdown (agent-specific instructions)
const DETECTIVE_INSTRUCTIONS_FILE = path.join(
  PROMPTS_DIR,
  "detective",
  "detective_instructions.md"
);
const LUMEN_INSTRUCTIONS_FILE = path.join(
  PROMPTS_DIR,
  "lumen",
  "lumen_instructions.md"
);
const UMBRA_INSTRUCTIONS_FILE = path.join(
  PROMPTS_DIR,
  "umbra",
  "umbra_instructions.md"
);

// Closers / closing behavior
const CLOSERS_FILE =
  process.env.CLOSERS_FILE || path.join(PROMPTS_DIR, "closers.md");
const CLOSING_INSTRUCTIONS_FILE =
  process.env.CLOSING_INSTRUCTIONS_FILE ||
  path.join(PROMPTS_DIR, "closing_instructions.md");

// Backend-triggered phil annotations (phase notes, etc.)
const PHIL_ANNOTATIONS_FILE =
  process.env.PHIL_ANNOTATIONS_FILE ||
  path.join(PROMPTS_DIR, "backend_phil_annotations.json");

// Detective-specific extras
const DETECTIVE_PROMPTS_DIR = path.join(PROMPTS_DIR, "detective");
const DETECTIVE_OPENING_LINES_FILE = path.join(
	DETECTIVE_PROMPTS_DIR,
	"detective_opening_lines.md"
);

// Turn schema files (structured output contracts for each agent)
const DETECTIVE_TURN_SCHEMA_FILE = path.join(
  PROMPTS_DIR,
  "detective",
  "detective_turn.schema.json"
);
const LUMEN_TURN_SCHEMA_FILE = path.join(
  PROMPTS_DIR,
  "lumen",
  "lumen_philosopher_turn.schema.json"
);
const UMBRA_TURN_SCHEMA_FILE = path.join(
  PROMPTS_DIR,
  "umbra",
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
// Optional: dedicated model for the attaché prelude. When unset,
// the attaché shares MODEL with the detective + philosophers.
const ATTACHE_MODEL = process.env.ATTACHE_MODEL || MODEL;
const SERVICE_TIER = process.env.OPENAI_SERVICE_TIER || null;
const MAX_HISTORY_LENGTH = 6000; // characters; adjust as needed
const MAX_USER_EXCHANGES = parseInt(process.env.MAX_USER_EXCHANGES, 10) || 5;
const CLOSURE_TURN_THRESHOLD = Math.max(2, MAX_USER_EXCHANGES - 2);
const MAX_DAILY_USAGE = parseInt(process.env.MAX_DAILY_USAGE, 10) || 100;
const DEV = /^(1|true|yes)$/i.test(process.env.DEV || "");
const OFFLINE = /^(1|true|yes)$/i.test(process.env.OFFLINE || "");
const DEBUG_LOGS = /^(1|true|yes)$/i.test(process.env.DEBUG_LOGS || "");
const DEBUG_LLM = /^(1|true|yes)$/i.test(process.env.DEBUG_LLM || "");
const DEBUG_STATE = /^(1|true|yes)$/i.test(process.env.DEBUG_STATE || "");

// ---------------------------------------------------------------------------
// Azure Table Storage (durable session / dossier / usage)
// Expected env: AZURE_STORAGE_CONNECTION_STRING + DOSSIER_TABLE_NAME only.
// ---------------------------------------------------------------------------

const AZURE_STORAGE_CONNECTION_STRING = String(
  process.env.AZURE_STORAGE_CONNECTION_STRING || ""
).trim();
const DOSSIER_TABLE_NAME = String(process.env.DOSSIER_TABLE_NAME || "").trim();
const DURABLE_STORAGE_EXPLICIT_OFF = /^(0|false|no)$/i.test(
  process.env.ENABLE_DURABLE_STORAGE || ""
);
const ENABLE_DURABLE_STORAGE =
  !DURABLE_STORAGE_EXPLICIT_OFF &&
  !!AZURE_STORAGE_CONNECTION_STRING &&
  !!DOSSIER_TABLE_NAME;

/** Max thread events stored per session (Azure row); oldest dropped first. */
const MAX_THREAD_EVENTS = Math.max(
  50,
  parseInt(process.env.MAX_THREAD_EVENTS, 10) || 400
);
/** Serialized JSON size guard for threadEventsJson (stay under Table Storage ~1 MB entity limit). */
const MAX_THREAD_JSON_CHARS = Math.max(
  50_000,
  parseInt(process.env.MAX_THREAD_JSON_CHARS, 10) || 800_000
);
/** Merged detective history string persisted on the session row. */
const MAX_DETECTIVE_HISTORY_CHARS = 450_000;

// ---------------------------------------------------------------------------
// Session return / rehydration (time-away buckets + baseline age for refresh)
// All durations from env in hours → hoursToMs(). Optional ms overrides per key.
//
// TIME_AWAY_DISABLE_MIN_GUARDS=1 — drops floors so tiny *_HOURS values work in dev
// (do not use in production).
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 60 * 60 * 1000;

function hoursToMs(hours) {
  return Math.round(hours * MS_PER_HOUR);
}

/** @param {string} envKey @returns {number|null} */
function readPositiveEnvMs(envKey) {
  const raw = process.env[envKey];
  if (raw == null || !String(raw).trim()) return null;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {string} envKey @param {number} defaultHours */
function readPositiveHours(envKey, defaultHours) {
  const raw = process.env[envKey];
  if (raw == null || !String(raw).trim()) return defaultHours;
  const n = parseFloat(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : defaultHours;
}

const TIME_AWAY_DISABLE_MIN_GUARDS = /^(1|true|yes)$/i.test(
  process.env.TIME_AWAY_DISABLE_MIN_GUARDS || ""
);
const TIME_AWAY_BRIEF_MS_FLOOR = TIME_AWAY_DISABLE_MIN_GUARDS ? 0 : 60_000;
const TIME_AWAY_STALE_MS_FLOOR = TIME_AWAY_DISABLE_MIN_GUARDS ? 0 : MS_PER_HOUR;

/**
 * “Just stepped away”: still the same visit / quick tab flip; below this gap we do not
 * force baseline refresh on return. Default 0.25 h (15 min).
 */
const TIME_AWAY_BRIEF_MS = (() => {
  const msOverride = readPositiveEnvMs("TIME_AWAY_BRIEF_MS");
  if (msOverride != null) return Math.max(TIME_AWAY_BRIEF_MS_FLOOR, msOverride);
  const hours = readPositiveHours("TIME_AWAY_BRIEF_HOURS", 0.25);
  return Math.max(TIME_AWAY_BRIEF_MS_FLOOR, hoursToMs(hours));
})();

/**
 * Long absence: roughly a day or a few — at or above this gap you are in the “long gone”
 * bucket (baseline refresh when already on detective). Default 42 h.
 */
const TIME_AWAY_LONG_MS = (() => {
  const msOverride = readPositiveEnvMs("TIME_AWAY_LONG_MS");
  if (msOverride != null) return Math.max(TIME_AWAY_BRIEF_MS + 1, msOverride);
  const hours = readPositiveHours("TIME_AWAY_LONG_HOURS", 42);
  return Math.max(TIME_AWAY_BRIEF_MS + 1, hoursToMs(hours));
})();

/**
 * How old the last baseline completion may be before we treat it as stale in the
 * middle time-away bucket (DAY_OR_SO + detective). Think “been a while” / multi-day;
 * raise hours toward ~168 for week-scale. Default 32 h.
 */
const TIME_AWAY_STALE_MS = (() => {
  const msOverride = readPositiveEnvMs("TIME_AWAY_STALE_MS");
  if (msOverride != null) return Math.max(TIME_AWAY_STALE_MS_FLOOR, msOverride);
  const hours = readPositiveHours("TIME_AWAY_STALE_HOURS", 32);
  return Math.max(TIME_AWAY_STALE_MS_FLOOR, hoursToMs(hours));
})();

const RETURN_POLICY_EXPLICIT_OFF = /^(0|false|no)$/i.test(
  process.env.ENABLE_RETURN_POLICY || ""
);
/** Master switch: return classification + routing (default on unless explicitly disabled). */
const ENABLE_RETURN_POLICY = !RETURN_POLICY_EXPLICIT_OFF;

/** When true: compute/log classification but do not mutate routing or session for refresh. */
const RETURN_POLICY_LOG_ONLY = /^(1|true|yes)$/i.test(
  process.env.RETURN_POLICY_LOG_ONLY || ""
);

// Streaming behaviour for /api/chat-stream.
// The backend already has the full reply; these control how it is sent
// to the browser as "delta" events. Frontend typing for non-streaming
// replies is in public/js/shared.typingConfig.js.
// In dev mode we send the whole reply in one chunk with no delay (instant).
/** Number of characters sent in each streamed chunk. Higher = fewer, bigger bursts. */
const STREAM_CHUNK_SIZE = DEV ? 999999 : 5;
/** Milliseconds to wait between each chunk. Lower = faster stream; 0 = no pause. */
const STREAM_DELAY_MS = DEV ? 0 : 8;

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
System note: Closure behavior is controlled by injected special instructions.
Do not assume additional closure flags exist in conversation_state unless provided.`;

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
  ATTACHE_MODEL,
  SERVICE_TIER,
  MAX_HISTORY_LENGTH,
  MAX_USER_EXCHANGES,
  CLOSURE_TURN_THRESHOLD,
  MAX_DAILY_USAGE,
  DEV,
  OFFLINE,
  DEBUG_LOGS,
  DEBUG_LLM,
  DEBUG_STATE,
  ENABLE_DURABLE_STORAGE,
  DOSSIER_TABLE_NAME,
  MAX_THREAD_EVENTS,
  MAX_THREAD_JSON_CHARS,
  MAX_DETECTIVE_HISTORY_CHARS,
  TIME_AWAY_BRIEF_MS,
  TIME_AWAY_LONG_MS,
  TIME_AWAY_STALE_MS,
  TIME_AWAY_DISABLE_MIN_GUARDS,
  ENABLE_RETURN_POLICY,
  RETURN_POLICY_LOG_ONLY,
  DETECTIVE_PROMPTS_DIR,
  DETECTIVE_OPENING_LINES_FILE,
  FRIENDLY_API_KEY_MESSAGE,
  requestOptions,
  agentPrompts,
  agentSchemas,
  STREAM_CHUNK_SIZE,
  STREAM_DELAY_MS,
};
