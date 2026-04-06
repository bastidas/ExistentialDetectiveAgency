"use strict";

const fs = require("fs");
const path = require("path");
const { getDebugStateLevel, getDebugPromptsLevel } = require("./logger");

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

const MAX_HISTORY_LENGTH = parseInt(process.env.MAX_HISTORY_LENGTH, 10) || 6000;
const MAX_DETECTIVE_HISTORY_CHARS = Math.max(50_000, parseInt(process.env.MAX_DETECTIVE_HISTORY_CHARS, 10) || 450_000);
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
  MAX_HISTORY_LENGTH,
  MAX_DETECTIVE_HISTORY_CHARS,
  DOSSIER_TABLE_NAME,
  DEBUG_STATE_LEVEL,
  DEBUG_PROMPTS_LEVEL,
  ALLOW_TEST_SEED,
};
