"use strict";

/**
 * Whether the user has a persisted dossier record worth loading into the chat orchestrator.
 * Uses the normalized dossier shape from `dossier.js` (explicit, inferred, meta).
 *
 * @param {object|null|undefined} dossier — loaded dossier from storage, if any
 * @returns {boolean}
 */
function userHasPersistedDossier(dossier) {
  if (dossier == null || typeof dossier !== "object") {
    return false;
  }

  const meta = dossier.meta;
  if (meta && typeof meta === "object") {
    if (meta.lastBaselineCompletedAt != null) {
      return true;
    }
    const bqa = meta.baselineQuestionsAnswered;
    if (typeof bqa === "number" && bqa > 0) {
      return true;
    }
  }

  const ex = dossier.explicit;
  if (ex && typeof ex === "object") {
    if (ex.name != null && String(ex.name).trim() !== "") {
      return true;
    }
    if (ex.preferredPronouns != null && String(ex.preferredPronouns).trim() !== "") {
      return true;
    }
    if (Array.isArray(ex.languages) && ex.languages.length > 0) {
      return true;
    }
  }

  const inf = dossier.inferred;
  if (inf && typeof inf === "object") {
    for (const v of Object.values(inf)) {
      if (Array.isArray(v) && v.length > 0) {
        return true;
      }
    }
  }

  return false;
}

module.exports = {
  userHasPersistedDossier,
};
