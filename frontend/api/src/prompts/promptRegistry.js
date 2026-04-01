"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");

const ATTACHE_PROMPTS_DIR = path.join(config.PROMPTS_DIR, "attache");
const ATTACHE_PERSONA_FILE = path.join(ATTACHE_PROMPTS_DIR, "attache_persona.md");
const ATTACHE_INSTRUCTIONS_FILE = path.join(ATTACHE_PROMPTS_DIR, "attache_instructions.md");
const ATTACHE_SCHEMA_FILE = path.join(ATTACHE_PROMPTS_DIR, "attache_turn.schema.json");
const SPECIAL_INSTRUCTIONS_CATALOG_FILE = path.join(
  config.PROMPTS_DIR,
  "catalog",
  "special_instructions.json"
);

const PROMPT_REGISTRY = Object.freeze({
  attache: {
    personaPath: ATTACHE_PERSONA_FILE,
    instructionsPath: ATTACHE_INSTRUCTIONS_FILE,
    outputSchemaPath: ATTACHE_SCHEMA_FILE,
    catalogPath: SPECIAL_INSTRUCTIONS_CATALOG_FILE,
    renderMode: "plain",
  },
  detective: {
    personaPath: config.DETECTIVE_PERSONA_FILE,
    instructionsPath: config.DETECTIVE_INSTRUCTIONS_FILE,
    outputSchemaPath: path.join(config.PROMPTS_DIR, "detective", "detective_turn.schema.json"),
    catalogPath: SPECIAL_INSTRUCTIONS_CATALOG_FILE,
    renderMode: "json_context",
  },
  final_detective: {
    personaPath: config.DETECTIVE_PERSONA_FILE,
    instructionsPath: config.CLOSING_INSTRUCTIONS_FILE,
    outputSchemaPath: path.join(config.PROMPTS_DIR, "detective", "detective_turn.schema.json"),
    catalogPath: SPECIAL_INSTRUCTIONS_CATALOG_FILE,
    renderMode: "json_context",
  },
  lumen: {
    personaPath: config.LUMEN_PERSONA_FILE,
    instructionsPath: config.LUMEN_INSTRUCTIONS_FILE,
    outputSchemaPath: path.join(config.PROMPTS_DIR, "lumen", "lumen_philosopher_turn.schema.json"),
    catalogPath: SPECIAL_INSTRUCTIONS_CATALOG_FILE,
    renderMode: "json_context",
  },
  umbra: {
    personaPath: config.UMBRA_PERSONA_FILE,
    instructionsPath: config.UMBRA_INSTRUCTIONS_FILE,
    outputSchemaPath: path.join(config.PROMPTS_DIR, "umbra", "umbra_philosopher_turn.schema.json"),
    catalogPath: SPECIAL_INSTRUCTIONS_CATALOG_FILE,
    renderMode: "json_context",
  },
});

function loadText(pathname) {
  try {
    if (!pathname || !fs.existsSync(pathname)) return "";
    return String(fs.readFileSync(pathname, "utf8") || "").trim();
  } catch (_) {
    return "";
  }
}

function loadJson(pathname) {
  try {
    if (!pathname || !fs.existsSync(pathname)) return null;
    return JSON.parse(fs.readFileSync(pathname, "utf8"));
  } catch (_) {
    return null;
  }
}

function getPromptRegistryEntry(agentKey) {
  return PROMPT_REGISTRY[agentKey] || null;
}

function validatePromptRegistry({ strict = false } = {}) {
  const errors = [];
  for (const [agentKey, entry] of Object.entries(PROMPT_REGISTRY)) {
    if (!entry) {
      errors.push(`${agentKey}: missing registry entry`);
      continue;
    }
    if (!fs.existsSync(entry.personaPath)) {
      errors.push(`${agentKey}: missing personaPath ${entry.personaPath}`);
    } else if (!loadText(entry.personaPath)) {
      errors.push(`${agentKey}: empty personaPath ${entry.personaPath}`);
    }
    if (!fs.existsSync(entry.instructionsPath)) {
      errors.push(`${agentKey}: missing instructionsPath ${entry.instructionsPath}`);
    } else if (!loadText(entry.instructionsPath)) {
      errors.push(`${agentKey}: empty instructionsPath ${entry.instructionsPath}`);
    }
    const schemaJson = loadJson(entry.outputSchemaPath);
    if (!schemaJson || typeof schemaJson !== "object") {
      errors.push(`${agentKey}: invalid outputSchemaPath ${entry.outputSchemaPath}`);
    }
    const catalogJson = loadJson(entry.catalogPath);
    if (!catalogJson || typeof catalogJson !== "object" || typeof catalogJson.version !== "number") {
      errors.push(`${agentKey}: invalid catalogPath ${entry.catalogPath}`);
    }
  }

  if (strict && errors.length) {
    throw new Error(`Prompt registry validation failed:\n${errors.join("\n")}`);
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  SPECIAL_INSTRUCTIONS_CATALOG_FILE,
  PROMPT_REGISTRY,
  getPromptRegistryEntry,
  validatePromptRegistry,
  loadText,
  loadJson,
};

