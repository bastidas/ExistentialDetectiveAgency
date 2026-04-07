"use strict";

const { userHasPersistedDossier } = require("../dossier_and_summarize/dossierPresence");

/**
 * Whether the chat session carries dossier material the attaché/detective prompts should treat as “has a dossier”
 * (loaded row or non-empty summary string from preview / compose).
 *
 * @param {object} session
 * @returns {boolean}
 */
function sessionHasDossierForPrompts(session) {
  const s = session && typeof session === "object" ? session : {};
  if (s.dossier != null && typeof s.dossier === "object" && userHasPersistedDossier(s.dossier)) {
    return true;
  }
  const summary = s.dossier_summary ?? s.dossierSummary;
  return typeof summary === "string" && summary.trim() !== "";
}

/**
 * Facts for `instructionSelection` / special-instruction catalog lookups.
 *
 * @param {object} [session]
 * @param {object} [internalState]
 * @returns {Record<string, unknown>}
 */
function extractReturnPromptFacts(session, internalState) {
  const s = session && typeof session === "object" ? session : {};
  const internal = internalState && typeof internalState === "object" ? internalState : {};
  const main = internal.mainState && typeof internal.mainState === "object" ? internal.mainState : {};

  const lastReturn =
    s.lastReturnClassification ||
    (s.baseline_return_greeting_pending === true && s.baseline_refresh_return_category
      ? { returnCategory: s.baseline_refresh_return_category }
      : null);

  const returnCategory =
    lastReturn && typeof lastReturn === "object" && lastReturn.returnCategory != null
      ? String(lastReturn.returnCategory)
      : null;

  const attacheBaselineDone = !!(main.attache && main.attache.baselineCompleted);

  const visitBin = s.visit_bin != null ? String(s.visit_bin) : null;
  const temporalGreetingMode =
    s.temporal_greeting_mode != null ? String(s.temporal_greeting_mode) : null;
  const dossierStaleByAge = s.dossier_stale_by_age === true;
  const staleDossierRebaseline = s.stale_dossier_rebaseline === true;
  const baselineReturnGreetingPending = s.baseline_return_greeting_pending === true;

  return {
    returnCategory,
    baselineCompleted: attacheBaselineDone,
    attachePromptFamilyKey: s.attachePromptFamilyKey ?? null,
    visit_bin: visitBin,
    temporal_greeting_mode: temporalGreetingMode,
    dossier_stale_by_age: dossierStaleByAge,
    stale_dossier_rebaseline: staleDossierRebaseline,
    baseline_return_greeting_pending: baselineReturnGreetingPending,
    has_dossier: sessionHasDossierForPrompts(s),
  };
}

module.exports = {
  extractReturnPromptFacts,
  sessionHasDossierForPrompts,
};
