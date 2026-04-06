"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");

/** @typedef {"initial"|"middle"|"final"} ExistentialTherapyPhaseId */

const PHASE_DIR = path.join(config.PROMPTS_DIR, "detective", "existential_therapy");

const FILE_BY_PHASE = Object.freeze({
  initial: path.join(PHASE_DIR, "initial.md"),
  middle: path.join(PHASE_DIR, "middle.md"),
  final: path.join(PHASE_DIR, "final.md"),
});

/** H3 titles under `# TURN INSTRUCTIONS`, parallel to return-state catalog entries */
const TURN_HEADING_BY_PHASE = Object.freeze({
  initial:
    "Instruction: Stage 1 (identification and clarification)—use techniques lightly unless the user is in an existential register",
  middle:
    "Instruction: Stage 2 (self-exploration and examination)—agency, patterns, and givens when the user is ready",
  final:
    "Instruction: Stage 3 (application of insights)—authentic choice and purpose without prescribing their life",
});

const VALID_PHASES = Object.freeze(["initial", "middle", "final"]);

/**
 * @param {unknown} v
 * @returns {v is ExistentialTherapyPhaseId}
 */
function isExistentialTherapyPhaseId(v) {
  return v === "initial" || v === "middle" || v === "final";
}

/**
 * @param {unknown} v
 * @returns {ExistentialTherapyPhaseId}
 */
function normalizeExistentialTherapyPhaseId(v) {
  const s = v == null ? "" : String(v).trim().toLowerCase();
  return isExistentialTherapyPhaseId(s) ? s : "initial";
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function loadTextFile(filePath) {
  if (!filePath || typeof filePath !== "string") return "";
  try {
    if (fs.existsSync(filePath)) {
      return String(fs.readFileSync(filePath, "utf8")).trim();
    }
  } catch (_) {}
  return "";
}

const CATALOG_KEY_BY_PHASE = Object.freeze({
  initial: "EXISTENTIAL_THERAPY_INITIAL",
  middle: "EXISTENTIAL_THERAPY_MIDDLE",
  final: "EXISTENTIAL_THERAPY_FINAL",
});

/**
 * @param {object|null|undefined} catalogJson — detective `prompt_catalog.json`
 * @param {ExistentialTherapyPhaseId} phaseId
 * @returns {{ title: string, body: string }|null}
 */
function getExistentialTherapyPhaseFromCatalog(catalogJson, phaseId) {
  const id = normalizeExistentialTherapyPhaseId(phaseId);
  const key = CATALOG_KEY_BY_PHASE[id];
  if (!key) return null;
  const map =
    catalogJson && catalogJson.entries && typeof catalogJson.entries === "object"
      ? catalogJson.entries
      : {};
  const entry = map[key];
  if (!entry || typeof entry !== "object") return null;
  const body = entry.body == null ? "" : String(entry.body).trim();
  if (!body) return null;
  const title = entry.title == null ? "" : String(entry.title).trim();
  return { title: title || TURN_HEADING_BY_PHASE[id], body };
}

/**
 * Markdown instructions for the existential therapy phase (injected under `# TURN INSTRUCTIONS`).
 * Prefer `instructionCatalog` (per-agent registry); fallback to `existential_therapy/*.md`.
 * @param {ExistentialTherapyPhaseId} phaseId
 * @param {object|null|undefined} [instructionCatalog]
 * @returns {string}
 */
function getExistentialTherapyPhaseMarkdown(phaseId, instructionCatalog) {
  const fromCat = getExistentialTherapyPhaseFromCatalog(instructionCatalog, phaseId);
  if (fromCat && fromCat.body) return fromCat.body;
  const id = normalizeExistentialTherapyPhaseId(phaseId);
  const p = FILE_BY_PHASE[id];
  return loadTextFile(p);
}

/**
 * @param {ExistentialTherapyPhaseId} phaseId
 * @param {object|null|undefined} [instructionCatalog]
 * @returns {string}
 */
function getExistentialTherapyPhaseTurnTitle(phaseId, instructionCatalog) {
  const fromCat = getExistentialTherapyPhaseFromCatalog(instructionCatalog, phaseId);
  if (fromCat && fromCat.title) return fromCat.title;
  const id = normalizeExistentialTherapyPhaseId(phaseId);
  return TURN_HEADING_BY_PHASE[id] || TURN_HEADING_BY_PHASE.initial;
}

/**
 * Same heading level as return-state catalog `title` fields (`###` under `# TURN INSTRUCTIONS`).
 * @param {unknown} phaseId
 * @returns {string}
 */
function getExistentialTherapyPhaseTurnHeading(phaseId) {
  const id = normalizeExistentialTherapyPhaseId(phaseId);
  return TURN_HEADING_BY_PHASE[id] || TURN_HEADING_BY_PHASE.initial;
}

module.exports = {
  PHASE_DIR,
  FILE_BY_PHASE,
  TURN_HEADING_BY_PHASE,
  CATALOG_KEY_BY_PHASE,
  VALID_PHASES,
  isExistentialTherapyPhaseId,
  normalizeExistentialTherapyPhaseId,
  getExistentialTherapyPhaseFromCatalog,
  getExistentialTherapyPhaseMarkdown,
  getExistentialTherapyPhaseTurnHeading,
  getExistentialTherapyPhaseTurnTitle,
};
