"use strict";

const fs = require("fs");
const path = require("path");
const { getDebugStateLevel, getDebugPromptsLevel } = require("./logger");

function resolvePromptsDir() {
  if (process.env.PROMPTS_DIR) {
    const envDir = path.resolve(process.cwd(), process.env.PROMPTS_DIR);
    if (fs.existsSync(envDir)) return envDir;
    if (fs.existsSync(process.env.PROMPTS_DIR)) {
      return path.resolve(process.env.PROMPTS_DIR);
    }
  }
  const apiLocalPrompts = path.resolve(__dirname, "prompts");
  if (fs.existsSync(apiLocalPrompts)) return apiLocalPrompts;
  const candidates = [
    path.resolve(process.cwd(), "api", "prompts"),
    path.resolve(process.cwd(), "prompts"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return path.resolve(dir);
    } catch (_) {}
  }
  const fallback = apiLocalPrompts;
  if (!fs.existsSync(fallback)) {
    console.warn("[config] PROMPTS_DIR not found; using fallback path:", fallback);
  }
  return fallback;
}

const PROMPTS_DIR = resolvePromptsDir();

const DETECTIVE_PERSONA_FILE = path.join(PROMPTS_DIR, "detective", "detective_persona.md");
const ATTACHE_PERSONA_FILE = path.join(PROMPTS_DIR, "attache", "attache_persona.md");
const LUMEN_PERSONA_FILE = path.join(PROMPTS_DIR, "lumen", "lumen_persona.md");
const UMBRA_PERSONA_FILE = path.join(PROMPTS_DIR, "umbra", "umbra_persona.md");

const DETECTIVE_INSTRUCTIONS_FILE = path.join(PROMPTS_DIR, "detective", "detective_instructions.md");
const ATTACHE_INSTRUCTIONS_FILE = path.join(PROMPTS_DIR, "attache", "attache_instructions.md");
const LUMEN_INSTRUCTIONS_FILE = path.join(PROMPTS_DIR, "lumen", "lumen_instructions.md");
const UMBRA_INSTRUCTIONS_FILE = path.join(PROMPTS_DIR, "umbra", "umbra_instructions.md");

const DETECTIVE_TURN_SCHEMA_FILE = path.join(PROMPTS_DIR, "detective", "detective_turn.schema.json");
const ATTACHE_TURN_SCHEMA_FILE = path.join(PROMPTS_DIR, "attache", "attache_turn.schema.json");
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

const DETECTIVE_PROMPTS_FILE = path.join(PROMPTS_DIR, "detective", "detective_prompts.md");
const ATTACHE_PROMPTS_FILE = path.join(PROMPTS_DIR, "attache", "attache_prompts.md");
const LUMEN_PROMPTS_FILE = path.join(PROMPTS_DIR, "lumen", "lumen_prompts.md");
const UMBRA_PROMPTS_FILE = path.join(PROMPTS_DIR, "umbra", "umbra_prompts.md");

/** @deprecated Prefer per-agent `*_PROMPT_CATALOG_FILE`; kept for scripts or external refs */
const SPECIAL_INSTRUCTIONS_CATALOG_FILE = path.join(
  PROMPTS_DIR,
  "catalog",
  "special_instructions.json"
);

const DETECTIVE_PROMPT_CATALOG_FILE = path.join(PROMPTS_DIR, "detective", "prompt_catalog.json");
const ATTACHE_PROMPT_CATALOG_FILE = path.join(PROMPTS_DIR, "attache", "prompt_catalog.json");
const LUMEN_PROMPT_CATALOG_FILE = path.join(PROMPTS_DIR, "lumen", "prompt_catalog.json");
const UMBRA_PROMPT_CATALOG_FILE = path.join(PROMPTS_DIR, "umbra", "prompt_catalog.json");

const PHIL_ANNOTATIONS_FILE =
  process.env.PHIL_ANNOTATIONS_FILE || path.join(PROMPTS_DIR, "backend_phil_annotations.json");

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
/** Per-request timeout for OpenAI HTTP calls (ms). Prevents the server from hanging until the client gives up. */
const OPENAI_TIMEOUT_MS = Math.max(
  10_000,
  parseInt(process.env.OPENAI_TIMEOUT_MS, 10) || 120_000
);
const OFFLINE = /^(1|true|yes)$/i.test(process.env.OFFLINE || "");
const DEBUG_LOGS = /^(1|true|yes)$/i.test(process.env.DEBUG_LOGS || "");
const MOCK_AGENT_DIAGNOSTICS = /^(1|true|yes)$/i.test(process.env.MOCK_AGENT_DIAGNOSTICS || "");

// Session restore + persistence naming group.
const CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY =
  parseInt(process.env.CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY, 10) || 6000;
const DETECTIVE_HISTORY_STORAGE_CHAR_LIMIT = Math.max(
  50_000,
  parseInt(process.env.DETECTIVE_HISTORY_STORAGE_CHAR_LIMIT, 10) || 450_000
);
const LAST_N_MESSAGES_FOR_DOSSIER = Math.max(
  1,
  parseInt(process.env.LAST_N_MESSAGES_FOR_DOSSIER, 10) || 12
);
const LAST_N_CLIENT_TRANSCRIPT_TURNS = Math.max(
  1,
  parseInt(process.env.LAST_N_CLIENT_TRANSCRIPT_TURNS, 10) || 100
);
/** Native chat-history tail sent to the model (not inside the JSON packet). */
const HISTORY_TAIL_TURNS = Math.max(
  1,
  parseInt(process.env.HISTORY_TAIL_TURNS, 10) || 8
);
const HISTORY_TURN_MAX_CHARS = Math.max(
  200,
  parseInt(process.env.HISTORY_TURN_MAX_CHARS, 10) || 4000
);
/** Upsert session row to Azure Table at least every K user turns (if dirty). */
const SESSION_CHECKPOINT_EVERY_K_TURNS = Math.max(
  1,
  parseInt(process.env.SESSION_CHECKPOINT_EVERY_K_TURNS, 10) || 5
);
/** Minimum ms between session checkpoints when dirty (throttle wall clock). */
const SESSION_CHECKPOINT_MIN_INTERVAL_MS = Math.max(
  1_000,
  parseInt(process.env.SESSION_CHECKPOINT_MIN_INTERVAL_MS, 10) || 300_000
);
const ENABLE_DURABLE_STORAGE_LEGACY = /^(1|true|yes)$/i.test(process.env.ENABLE_DURABLE_STORAGE || "");
/**
 * @returns {"off"|"azurite"|"azure-cloud"}
 */
function resolveDurableStorageMode() {
  const mode = String(process.env.DURABLE_STORAGE_MODE || "").trim().toLowerCase();
  if (mode === "off" || mode === "azurite" || mode === "azure-cloud") return mode;
  return ENABLE_DURABLE_STORAGE_LEGACY ? "azure-cloud" : "off";
}
const DOSSIER_TABLE_NAME = String(process.env.DOSSIER_TABLE_NAME || "").trim();

const DEBUG_STATE_LEVEL = getDebugStateLevel();
const DEBUG_PROMPTS_LEVEL = getDebugPromptsLevel();

/** When true, `POST /api/dev/chat-scenario` can seed chat orchestration state (local dev only). */
const ALLOW_TEST_SEED = /^(1|true|yes)$/i.test(process.env.ALLOW_TEST_SEED || "");

module.exports = {
  PROMPTS_DIR,
  DETECTIVE_PERSONA_FILE,
  ATTACHE_PERSONA_FILE,
  LUMEN_PERSONA_FILE,
  UMBRA_PERSONA_FILE,
  DETECTIVE_INSTRUCTIONS_FILE,
  ATTACHE_INSTRUCTIONS_FILE,
  LUMEN_INSTRUCTIONS_FILE,
  UMBRA_INSTRUCTIONS_FILE,
  DETECTIVE_TURN_SCHEMA_FILE,
  ATTACHE_TURN_SCHEMA_FILE,
  LUMEN_TURN_SCHEMA_FILE,
  UMBRA_TURN_SCHEMA_FILE,
  DETECTIVE_PROMPTS_FILE,
  ATTACHE_PROMPTS_FILE,
  LUMEN_PROMPTS_FILE,
  UMBRA_PROMPTS_FILE,
  SPECIAL_INSTRUCTIONS_CATALOG_FILE,
  DETECTIVE_PROMPT_CATALOG_FILE,
  ATTACHE_PROMPT_CATALOG_FILE,
  LUMEN_PROMPT_CATALOG_FILE,
  UMBRA_PROMPT_CATALOG_FILE,
  PHIL_ANNOTATIONS_FILE,
  MODEL,
  OPENAI_TIMEOUT_MS,
  OFFLINE,
  DEBUG_LOGS,
  MOCK_AGENT_DIAGNOSTICS,
  CONVERSATION_CHAR_THRESHOLD_BEFORE_SUMMARY,
  DETECTIVE_HISTORY_STORAGE_CHAR_LIMIT,
  LAST_N_MESSAGES_FOR_DOSSIER,
  LAST_N_CLIENT_TRANSCRIPT_TURNS,
  HISTORY_TAIL_TURNS,
  HISTORY_TURN_MAX_CHARS,
  SESSION_CHECKPOINT_EVERY_K_TURNS,
  SESSION_CHECKPOINT_MIN_INTERVAL_MS,
  ENABLE_DURABLE_STORAGE_LEGACY,
  resolveDurableStorageMode,
  DOSSIER_TABLE_NAME,
  DEBUG_STATE_LEVEL,
  DEBUG_PROMPTS_LEVEL,
  ALLOW_TEST_SEED,
};
