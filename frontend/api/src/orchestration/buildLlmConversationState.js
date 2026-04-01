"use strict";

const {
  DEFAULT_THERAPY_PHASE_KEY,
  DEFAULT_EXISTENTIAL_PHASE_KEY,
  DEFAULT_NARRATIVE_PHASE_KEY,
  THERAPY_PHASE_LABELS,
  EXISTENTIAL_PHASE_LABELS,
  NARRATIVE_PHASE_LABELS,
} = require("./orchestrationModels");

function asTrimmedString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function readConfidence(entry) {
  if (!entry || typeof entry !== "object") return null;
  const c = entry.confidence;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

function normalizeTraitDisplayValue(traitName, entry) {
  if (!entry || typeof entry !== "object") return null;
  const candidates = [entry.value, entry.topic, entry.range, entry.location, entry.trait];
  for (const raw of candidates) {
    const s = asTrimmedString(raw);
    if (s) return s;
  }
  const fallback = asTrimmedString(entry[traitName]);
  return fallback || null;
}

function buildDossierSummaryForLlm(dossier) {
  const explicitName =
    dossier && dossier.explicit ? asTrimmedString(dossier.explicit.name) : null;
  const inferred = dossier && dossier.inferred && typeof dossier.inferred === "object"
    ? dossier.inferred
    : {};

  const traits = [];
  for (const [traitName, entries] of Object.entries(inferred)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const confidence = readConfidence(entry);
      if (confidence == null || confidence < 0.5) continue;
      const displayValue = normalizeTraitDisplayValue(traitName, entry);
      if (!displayValue) continue;
      traits.push({
        traitName,
        displayValue,
        confidence,
        evidence: asTrimmedString(entry.evidence),
        notes: asTrimmedString(entry.notes),
      });
    }
  }

  return {
    explicitName,
    traits,
  };
}

function buildPrecedingConversationSummary(sessionSummaries) {
  if (!sessionSummaries || typeof sessionSummaries !== "object") return null;
  const sections = [];
  const baseline = asTrimmedString(sessionSummaries.baselineAttache);
  const detective = asTrimmedString(sessionSummaries.userDetective);
  const philosophers = asTrimmedString(sessionSummaries.philosophersInternal);

  if (baseline) sections.push(`Baseline summary:\n${baseline}`);
  if (detective) sections.push(`Detective summary:\n${detective}`);
  if (philosophers) sections.push(`Philosopher summary:\n${philosophers}`);
  if (!sections.length) return null;
  return sections.join("\n\n");
}

function readNarrativePhase(internalState) {
  const raw = asTrimmedString(
    internalState &&
      internalState.mainState &&
      internalState.mainState.philosophers &&
      internalState.mainState.philosophers.narrativePhase
  );
  const key = raw || DEFAULT_NARRATIVE_PHASE_KEY;
  return NARRATIVE_PHASE_LABELS[key] || NARRATIVE_PHASE_LABELS[DEFAULT_NARRATIVE_PHASE_KEY];
}

function readTherapyPhase(internalState) {
  const raw = asTrimmedString(
    internalState &&
      internalState.mainState &&
      internalState.mainState.detective &&
      internalState.mainState.detective.therapyPhase
  );
  const key = raw || DEFAULT_THERAPY_PHASE_KEY;
  return THERAPY_PHASE_LABELS[key] || THERAPY_PHASE_LABELS[DEFAULT_THERAPY_PHASE_KEY];
}

function readExistentialPhase(internalState) {
  const raw = asTrimmedString(
    internalState &&
      internalState.mainState &&
      internalState.mainState.detective &&
      internalState.mainState.detective.existentialPhase
  );
  const key = raw || DEFAULT_EXISTENTIAL_PHASE_KEY;
  return EXISTENTIAL_PHASE_LABELS[key] || EXISTENTIAL_PHASE_LABELS[DEFAULT_EXISTENTIAL_PHASE_KEY];
}

function readSecrets(internalState, agentKey) {
  const all =
    internalState &&
    internalState.mainState &&
    internalState.mainState.philosophers &&
    internalState.mainState.philosophers.secretsRevealed;
  const list = all && typeof all === "object" ? all[agentKey] : null;
  return Array.isArray(list) ? list.map(String).map((s) => s.trim()).filter(Boolean) : [];
}

function buildLlmConversationState(agentKey, options) {
  const internalState =
    options && options.internalState && typeof options.internalState === "object"
      ? options.internalState
      : {};
  const session = options && options.session && typeof options.session === "object"
    ? options.session
    : {};
  const dossierSummary = buildDossierSummaryForLlm(session.dossier || null);
  const preceding = buildPrecedingConversationSummary(session.conversationSummaries);

  const base = { dossier_summary: dossierSummary, preceding_conversation_summary: preceding };

  if (agentKey === "detective" || agentKey === "final_detective") {
    return {
      ...base,
      therapy_phase: readTherapyPhase(internalState),
      existential_phase: readExistentialPhase(internalState),
    };
  }

  if (agentKey === "lumen" || agentKey === "umbra") {
    return {
      ...base,
      narrative_phase: readNarrativePhase(internalState),
      secrets_revealed: readSecrets(internalState, agentKey),
    };
  }

  return base;
}

module.exports = {
  buildDossierSummaryForLlm,
  buildPrecedingConversationSummary,
  buildLlmConversationState,
};
