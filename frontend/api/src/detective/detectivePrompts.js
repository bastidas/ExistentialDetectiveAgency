"use strict";

/**
 * ============================================================================
 * WARNING — TEXT HERE IS SENT TO THE REAL LLM (OpenAI `messages[].role === "system"`)
 * ============================================================================
 *
 * `getDetectiveTurnInstructions` / `# TURN INSTRUCTIONS` are composed into the system prompt
 * via `promptComposer.composeAgentPrompt` → `buildDetectiveTurnInstructionBlock`. Every line in
 * that custom block is model-facing. Return rows and existential therapy come from `prompts/detective/prompt_catalog.json`.
 * Scene guidance (`DETECTIVE_SCENE_GUIDANCE_FIRST`) is injected only in a narrow case—see `shouldInjectDetectiveOpeningSceneGuidance`.
 *
 * DO NOT embed orchestrator telemetry, raw session dumps, internal IDs, or debugging prose here
 * unless you deliberately want the model to see it. (Visit tier / ms / routing summaries belong in
 * `llmSafeState` for logs and the scenario lab — not in this string.)
 *
 * If you add any new meta, routing, or “State note:” content to the LLM again, stop and:
 *   1) Warn in PR/commit message and in comments next to the addition.
 *   2) Confirm product intent: only character instructions and vetted catalog copy belong in-channel.
 * ============================================================================
 */

const { userHasPersistedDossier } = require("../dossier_and_summarize/dossierPresence");
const { buildLlmConversationState } = require("../orchestration/buildLlmConversationState");
const { getRandomDetectiveOpeningLine } = require("./detectiveOpeningLines");
const {
  getExistentialTherapyPhaseMarkdown,
  getExistentialTherapyPhaseTurnTitle,
  normalizeExistentialTherapyPhaseId,
} = require("./existentialTherapyPhaseContent");
const { isDetectiveSessionFirstTurn } = require("./detectiveSessionTurn");

const PRE_TURN_INSTRUCTIONS = "# TURN INSTRUCTIONS\n";

/** Catalog id for “querent arriving” opening-scene copy; injected only when `shouldInjectDetectiveOpeningSceneGuidance` is true. */
const SCENE_GUIDANCE_FIRST_CATALOG_KEY = "DETECTIVE_SCENE_GUIDANCE_FIRST";

/**
 * @param {Record<string, unknown>|null|undefined} session
 * @returns {boolean}
 */
function sessionHasDossierOrCaseFileContext(session) {
  const s = session && typeof session === "object" ? session : {};
  if (s.has_dossier === true || s.hasDossier === true) return true;
  const summary = s.dossier_summary ?? s.dossierSummary;
  if (summary != null && String(summary).trim() !== "") return true;
  if (s.dossier != null && typeof s.dossier === "object" && userHasPersistedDossier(s.dossier)) {
    return true;
  }
  return false;
}

/**
 * Whether to inject `DETECTIVE_SCENE_GUIDANCE_FIRST` (opening line + “just arriving” copy).
 * Requires **all**: explicit first detective turn, **brief** visit bin only (same-visit / under brief threshold),
 * and **no** dossier or case-file context—otherwise the user is a returning client, or the gap is not “nothing happened.”
 * If turn signals are missing, returns false (never guess “first turn” from absent fields).
 *
 * @param {Record<string, unknown>|null|undefined} session
 * @returns {boolean}
 */
function shouldInjectDetectiveOpeningSceneGuidance(session) {
  const s = session && typeof session === "object" ? session : {};

  if (typeof s.detective_turn_count === "number" && Number.isFinite(s.detective_turn_count) && s.detective_turn_count !== 0) {
    return false;
  }
  if (s.detective_first_turn === false) return false;

  const explicitFirst =
    s.detective_first_turn === true ||
    (typeof s.detective_turn_count === "number" &&
      Number.isFinite(s.detective_turn_count) &&
      s.detective_turn_count === 0);
  if (!explicitFirst) return false;

  const bin = s.visit_bin != null ? String(s.visit_bin).trim().toLowerCase() : "";
  if (bin !== "brief") return false;

  if (sessionHasDossierOrCaseFileContext(s)) return false;

  return true;
}

function joinNonEmpty(parts) {
  return parts.map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");
}

/** Avoid duplicate top-level `#` under `### Existential therapy` (phase files often open with `# Title`). */
function stripLeadingMarkdownH1(text) {
  const t = String(text || "").trim();
  if (!t) return t;
  const lines = t.split("\n");
  if (lines.length && /^#\s+/.test(lines[0].trim())) {
    return lines.slice(1).join("\n").trim();
  }
  return t;
}

function fillTemplate(template, ctx) {
  if (!template || typeof template !== "string") return "";
  let out = template;
  const c = ctx && typeof ctx === "object" ? ctx : {};
  for (const [k, v] of Object.entries(c)) {
    if (v == null) continue;
    const re = new RegExp(`\\{${k}\\}`, "g");
    out = out.replace(re, String(v));
  }
  return out;
}

/**
 * Opening scene guidance from `prompt_catalog.json` (`DETECTIVE_SCENE_GUIDANCE_FIRST`); do not hardcode model-facing prose here.
 *
 * Injected only when `shouldInjectDetectiveOpeningSceneGuidance` (first detective turn + brief visit + no dossier).
 *
 * @param {object|null|undefined} instructionCatalog — loaded detective catalog JSON
 * @param {Record<string, unknown>} session
 * @param {Record<string, unknown>} conv — template context from `buildLlmConversationState`
 * @param {string} random_opening_line — filled into `{random_opening_line}`
 * @returns {string} markdown block `### Scene guidance\n\n…` or empty
 */
function getSceneGuidanceBlockFromCatalog(instructionCatalog, session, conv, random_opening_line) {
  if (!shouldInjectDetectiveOpeningSceneGuidance(session)) return "";
  const catalog = instructionCatalog && typeof instructionCatalog === "object" ? instructionCatalog : null;
  const entries =
    catalog && catalog.entries && typeof catalog.entries === "object" ? catalog.entries : null;
  const entry = entries && entries[SCENE_GUIDANCE_FIRST_CATALOG_KEY];
  if (!entry || typeof entry !== "object") return "";
  const title = entry.title != null ? String(entry.title).trim() : "";
  let body = entry.body == null ? "" : String(entry.body).trim();
  if (!body) return "";
  body = fillTemplate(body, { ...conv, random_opening_line });
  return title ? `### ${title}\n\n${body}` : body;
}

/**
 * Whether this turn should use first-turn opening instructions.
 * @param {Record<string, unknown>} session
 * @param {Record<string, unknown>} internalState
 * @param {Record<string, unknown>} conv — from buildLlmConversationState
 */
function isDetectiveFirstTurn(session, conv) {
  const s = session && typeof session === "object" ? session : {};
  if (s.detective_first_turn === true) return true;
  if (s.detective_first_turn === false) return false;
  if (conv && conv.detective_first_turn === true) return true;
  if (conv && conv.detective_first_turn === false) return false;
  if (typeof s.detective_turn_count === "number") return s.detective_turn_count === 0;
  return true;
}

/**
 * Per-turn markdown block for `composeAgentPrompt` `custom` (single detective agent; xstate owns phase).
 *
 * @param {"detective"} _agentKey — kept for call-site compatibility; always `"detective"`.
 * @param {object} [session]
 * @param {object} [internalState]
 * @param {{ catalogBodies?: string[], catalogEntries?: { id: string, title: string, body: string }[], instructionCatalog?: object }} [options]
 * — Return-state rows from detective `prompt_catalog.json` (`title` + `body`) on **first detective turn only**;
 * `DETECTIVE_RETURN_*` omitted afterward. No raw orchestrator telemetry in this block (see file header).
 * Existential therapy from same catalog when `instructionCatalog` is set; else fallback `.md` files.
 * Omitted when `closure_phase === "ultimate"` so the final reply follows closure instructions only.
 * @returns {string}
 */
function getDetectiveTurnInstructions(_agentKey, session, internalState, options) {
  const opt = options && typeof options === "object" ? options : {};
  const catalogBodies = Array.isArray(opt.catalogBodies) ? opt.catalogBodies.filter(Boolean) : [];
  const catalogEntries = Array.isArray(opt.catalogEntries) ? opt.catalogEntries : [];
  const instructionCatalog =
    opt.instructionCatalog && typeof opt.instructionCatalog === "object" ? opt.instructionCatalog : null;

  const conv = buildLlmConversationState("detective", {
    session: session && typeof session === "object" ? session : {},
    internalState: internalState && typeof internalState === "object" ? internalState : {},
  });
  const s = session && typeof session === "object" ? session : {};
  const randomFromCtx =
    s.random_opening_line != null && String(s.random_opening_line).trim() !== ""
      ? String(s.random_opening_line).trim()
      : null;
  const random_opening_line =
    randomFromCtx != null ? randomFromCtx : (getRandomDetectiveOpeningLine() || "").trim();

  const phaseId = normalizeExistentialTherapyPhaseId(s.existential_therapy_phase ?? s.existentialTherapyPhase);
  const phaseMdRaw = getExistentialTherapyPhaseMarkdown(phaseId, instructionCatalog);
  const phaseBody =
    phaseMdRaw && String(phaseMdRaw).trim() !== ""
      ? stripLeadingMarkdownH1(String(phaseMdRaw).trim())
      : "_(No phase-specific instructions loaded for this phase.)_";
  const therapyHeading = getExistentialTherapyPhaseTurnTitle(phaseId, instructionCatalog);

  const closurePhaseRaw =
    s.closure_phase != null ? String(s.closure_phase).trim().toLowerCase() : "";
  /** Ultimate closure: only `DETECTIVE_CLOSURE_ULTIMATE` applies—omit phase therapy so the model focuses on sign-off. */
  const omitExistentialTherapyForClosure = closurePhaseRaw === "ultimate";

  /** Return-state catalog rows: first detective turn after handoff, and not closure cap turns. */
  const injectVisitTiming = isDetectiveSessionFirstTurn(s) && !s.closure_phase;

  /** @type {string[]} */
  const parallelBlocks = [];
  const returnCatalogPrefix = /^DETECTIVE_RETURN_/i;
  if (catalogEntries.length > 0) {
    for (const e of catalogEntries) {
      const id = e && e.id != null ? String(e.id).trim() : "";
      if (!injectVisitTiming && returnCatalogPrefix.test(id)) continue;
      const title = e && e.title != null ? String(e.title).trim() : "";
      const body = e && e.body != null ? String(e.body).trim() : "";
      if (!body) continue;
      parallelBlocks.push(title ? `### ${title}\n\n${body}` : body);
    }
  } else if (injectVisitTiming && catalogBodies.length > 0) {
    for (const b of catalogBodies) {
      const t = String(b || "").trim();
      if (t) parallelBlocks.push(t);
    }
  }
  if (!omitExistentialTherapyForClosure) {
    parallelBlocks.push(`### ${therapyHeading}\n\n${phaseBody}`);
  }

  const sceneBlock = getSceneGuidanceBlockFromCatalog(
    instructionCatalog,
    s,
    conv,
    random_opening_line
  );
  if (sceneBlock) parallelBlocks.push(sceneBlock);

  let block = PRE_TURN_INSTRUCTIONS;
  block += joinNonEmpty(parallelBlocks) + "\n";
  return block;
}

module.exports = {
  PRE_TURN_INSTRUCTIONS,
  SCENE_GUIDANCE_FIRST_CATALOG_KEY,
  getDetectiveTurnInstructions,
  getSceneGuidanceBlockFromCatalog,
  shouldInjectDetectiveOpeningSceneGuidance,
  sessionHasDossierOrCaseFileContext,
  fillTemplate,
  isDetectiveFirstTurn,
  isDetectiveSessionFirstTurn,
};

