"use strict";

const fs = require("fs");
const path = require("path");

const config = require("../config");

/**
 * @typedef {Object} PromptRegistryEntry
 * @property {string} personaPath
 * @property {string} instructionsPath
 * @property {string} outputSchemaPath
 * @property {string} catalogPath
 * @property {string} [promptsPath]
 */

const PROMPT_REGISTRY = Object.freeze({
  attache: {
    personaPath: config.ATTACHE_PERSONA_FILE,
    instructionsPath: config.ATTACHE_INSTRUCTIONS_FILE,
    outputSchemaPath: config.ATTACHE_TURN_SCHEMA_FILE,
    catalogPath: config.ATTACHE_PROMPT_CATALOG_FILE,
    promptsPath: config.ATTACHE_PROMPTS_FILE,
  },
  detective: {
    personaPath: config.DETECTIVE_PERSONA_FILE,
    instructionsPath: config.DETECTIVE_INSTRUCTIONS_FILE,
    outputSchemaPath: config.DETECTIVE_TURN_SCHEMA_FILE,
    catalogPath: config.DETECTIVE_PROMPT_CATALOG_FILE,
    promptsPath: config.DETECTIVE_PROMPTS_FILE,
  },
  lumen: {
    personaPath: config.LUMEN_PERSONA_FILE,
    instructionsPath: config.LUMEN_INSTRUCTIONS_FILE,
    outputSchemaPath: config.LUMEN_TURN_SCHEMA_FILE,
    catalogPath: config.LUMEN_PROMPT_CATALOG_FILE,
    promptsPath: config.LUMEN_PROMPTS_FILE,
    renderMode: "plain",
  },
  umbra: {
    personaPath: config.UMBRA_PERSONA_FILE,
    instructionsPath: config.UMBRA_INSTRUCTIONS_FILE,
    outputSchemaPath: config.UMBRA_TURN_SCHEMA_FILE,
    catalogPath: config.UMBRA_PROMPT_CATALOG_FILE,
    promptsPath: config.UMBRA_PROMPTS_FILE,
  },
});

/**
 * @param {string} agentKey
 * @returns {PromptRegistryEntry|undefined}
 */
function getPromptRegistryEntry(agentKey) {
  if (!agentKey || typeof agentKey !== "string") return undefined;
  return PROMPT_REGISTRY[agentKey];
}

function loadText(filePath) {
  if (!filePath || typeof filePath !== "string") return "";
  try {
    if (fs.existsSync(filePath)) {
      return String(fs.readFileSync(filePath, "utf8")).trim();
    }
  } catch (_) {}
  return "";
}

function loadJson(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    }
  } catch (_) {}
  return null;
}

/**
 * Catalog entries normally require a non-empty `body`. Entries may set `tags` to include `allow_empty_body`
 * when intentionally blank (e.g. `DETECTIVE_RETURN_BRIEF`: under the brief time-away threshold — no return-instruction block;
 * `ATTACHE_RETURN_APPEND_FRESH_DOSSIER`: no extra dossier append line when the file is already current).
 *
 * @param {{ strict?: boolean }} [opts]
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePromptRegistry(opts = {}) {
  const strict = !!opts.strict;
  const errors = [];
  for (const [key, entry] of Object.entries(PROMPT_REGISTRY)) {
    const paths = [
      ["personaPath", entry.personaPath],
      ["instructionsPath", entry.instructionsPath],
      ["outputSchemaPath", entry.outputSchemaPath],
      ["catalogPath", entry.catalogPath],
    ];
    for (const [label, p] of paths) {
      if (!p || !fs.existsSync(p)) {
        errors.push(`registry[${key}].${label}: missing or unreadable: ${p || "(empty)"}`);
      }
    }
    const catPath = entry.catalogPath;
    if (catPath && fs.existsSync(catPath)) {
      try {
        const raw = fs.readFileSync(catPath, "utf8");
        const j = JSON.parse(raw);
        if (!j || typeof j !== "object" || !j.entries || typeof j.entries !== "object") {
          errors.push(`registry[${key}].catalogPath: expected { version?, entries: { ... } }`);
        } else {
          for (const [eid, ent] of Object.entries(j.entries)) {
            if (!ent || typeof ent !== "object") {
              errors.push(`registry[${key}].catalogPath entries[${eid}]: not an object`);
            } else if (ent.body == null || String(ent.body).trim() === "") {
              const tags = Array.isArray(ent.tags) ? ent.tags : [];
              const allowEmptyBody = tags.includes("allow_empty_body");
              if (!allowEmptyBody) {
                errors.push(`registry[${key}].catalogPath entries[${eid}]: missing body`);
              }
            }
          }
        }
      } catch (e) {
        errors.push(`registry[${key}].catalogPath: invalid JSON: ${e && e.message ? e.message : String(e)}`);
      }
    }
  }
  const ok = errors.length === 0;
  if (strict && !ok) {
    throw new Error(`validatePromptRegistry failed:\n${errors.join("\n")}`);
  }
  return { ok, errors };
}

module.exports = {
  PROMPT_REGISTRY,
  getPromptRegistryEntry,
  validatePromptRegistry,
  loadText,
  loadJson,
};
