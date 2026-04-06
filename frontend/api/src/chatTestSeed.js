"use strict";

/**
 * Orchestrator-only presets for dev scenario lab and tests.
 *
 * Preset shape (v1):
 * - `msSinceLastVisit` — optional non-negative ms (wins over `timeAwayBin` if both set)
 * - `timeAwayBin` — optional `brief` | `moderate` | `long` | `stale` (derived ms from current `getTimeAwayThresholds()`)
 * - `hasDossier` — when true, seeds a minimal persisted dossier (`lastBaselineCompletedAt`) so `userHasPersistedDossier` is true
 * - `activeAgent` — `attache` | `detective` — target routing after seed (see rules below)
 * - `baselineCompleted` — optional boolean; when set, overrides `activeAgent` (`true` → detective handoff path, `false` → attaché prelude)
 * - `attachePhase` — optional lab key when final routing is attaché: `start` | `explore` | `baseline1` | `baseline2` | `baseline3` | `close` | `close_final` (seeds in-memory attaché session for the next chat turn)
 *
 * Rules:
 * - `detective` + `hasDossier`: fresh dossier keeps routing on detective at any time-away (no clamp).
 * - `attache` + `hasDossier`: ms is raised into long/stale window and dossier is aged past `longMs` so `LONG_ABSENCE_USE_ATTACHE` applies.
 * - `detective` without dossier: attaché snapshot + `notifyAttachePreludeComplete` (handoff).
 */

const {
  clearPersistedChatMachineSnapshot,
  runChatTurn,
  notifyAttachePreludeComplete,
  getChatEnvelopeForSession,
} = require("./orchestration/chatMachine");
const { classifyTimeAway, getTimeAwayThresholds } = require("./orchestration/timeAwayClassification");
const {
  setDossierForDevSession,
  setAttacheSessionForDevSession,
  syncLabDetectiveOrchestrationFromPreset,
} = require("./chatService");
const { createEmptyDossier } = require("./dossier_and_summarize/dossier");
const { createInitialAttacheSessionState } = require("./attache/attacheRuntime");
const { attacheStateFromLabPreset } = require("./chatScenarioPreview");

/**
 * @param {'brief'|'moderate'|'long'|'stale'} bin
 * @returns {number}
 */
function msForTimeAwayBin(bin) {
  const { briefMs, moderateMs, longMs } = getTimeAwayThresholds();
  switch (bin) {
    case "brief":
      return Math.min(1000, Math.max(0, briefMs - 1));
    case "moderate":
      return briefMs + Math.floor((moderateMs - briefMs) / 2);
    case "long":
      return moderateMs + Math.floor((longMs - moderateMs) / 2);
    case "stale":
      return longMs + 60 * 60 * 1000;
    default:
      return 0;
  }
}

/**
 * @param {object} preset
 * @returns {number}
 */
function deriveMs(preset) {
  if (typeof preset.msSinceLastVisit === "number" && Number.isFinite(preset.msSinceLastVisit)) {
    return Math.max(0, preset.msSinceLastVisit);
  }
  const bin = preset.timeAwayBin;
  if (typeof bin === "string" && bin.length > 0) {
    return msForTimeAwayBin(/** @type {'brief'|'moderate'|'long'|'stale'} */ (bin));
  }
  return 0;
}

/**
 * @param {string} sessionId
 * @returns {object}
 */
function buildFreshMinimalDossier(sessionId) {
  const d = createEmptyDossier(sessionId);
  d.meta.lastBaselineCompletedAt = Date.now();
  return d;
}

/**
 * @param {string} sessionId
 * @param {number} longMsBound
 * @returns {object}
 */
function buildStaleMinimalDossier(sessionId, longMsBound) {
  const d = createEmptyDossier(sessionId);
  d.meta.lastBaselineCompletedAt = Date.now() - longMsBound - 60_000;
  return d;
}

/**
 * @param {string} sessionId
 * @param {object} [preset]
 * @returns {{ envelope: object|null, tier: ReturnType<typeof classifyTimeAway> }}
 */
function seedSessionScenario(sessionId, preset) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("seedSessionScenario: sessionId required");
  }
  const p = preset && typeof preset === "object" ? preset : {};
  const hasDossier = p.hasDossier === true;
  let activeAgent;
  if (typeof p.baselineCompleted === "boolean") {
    activeAgent = p.baselineCompleted ? "detective" : "attache";
  } else {
    activeAgent = p.activeAgent === "detective" ? "detective" : "attache";
  }

  let ms = deriveMs(p);
  const { longMs } = getTimeAwayThresholds();

  if (activeAgent === "attache" && hasDossier) {
    ms = Math.max(ms, longMs);
  }

  clearPersistedChatMachineSnapshot(sessionId);
  setDossierForDevSession(sessionId, null);

  let dossier = null;
  if (hasDossier) {
    dossier =
      activeAgent === "attache"
        ? buildStaleMinimalDossier(sessionId, longMs)
        : buildFreshMinimalDossier(sessionId);
    setDossierForDevSession(sessionId, dossier);
  }

  runChatTurn(sessionId, "__seed__", { msSinceLastVisit: ms, dossier });

  if (activeAgent === "detective" && !hasDossier) {
    notifyAttachePreludeComplete(sessionId);
  }

  if (
    activeAgent === "attache" &&
    typeof p.attachePhase === "string" &&
    p.attachePhase.trim() !== ""
  ) {
    const attacheState = attacheStateFromLabPreset(p);
    const sessionWrap = createInitialAttacheSessionState({ attacheState });
    setAttacheSessionForDevSession(sessionId, sessionWrap);
  }

  syncLabDetectiveOrchestrationFromPreset(sessionId, p);

  const tier = classifyTimeAway(ms);
  const envelope = getChatEnvelopeForSession(sessionId);
  return { envelope, tier };
}

module.exports = {
  seedSessionScenario,
  msForTimeAwayBin,
  deriveMs,
};
