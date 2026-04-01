"use strict";

const MainSpeaker = Object.freeze({
  ATTACHE: "ATTACHE",
  DETECTIVE: "DETECTIVE",
});

const RehydrationStatus = Object.freeze({
  FRESH: "FRESH",
  REHYDRATED: "REHYDRATED",
});

const TherapyPhase = Object.freeze({
  EXTERNALIZING_PROBLEM: "EXTERNALIZING_PROBLEM",
  MAPPING_INFLUENCE: "MAPPING_INFLUENCE",
  FINDING_UNIQUE_OUTCOMES: "FINDING_UNIQUE_OUTCOMES",
  DECONSTRUCTING_PROBLEM_STORIES: "DECONSTRUCTING_PROBLEM_STORIES",
  REAUTHORING_NARRATIVE: "REAUTHORING_NARRATIVE",
});

const ExistentialPhase = Object.freeze({
  EXISTENCE_SAFETY: "EXISTENCE_SAFETY",
  VALUE_CONNECTION: "VALUE_CONNECTION",
  IDENTITY_AUTHENTICITY: "IDENTITY_AUTHENTICITY",
  PURPOSE_MEANING: "PURPOSE_MEANING",
});

const NarrativePhase = Object.freeze({
  EXPOSITION: "EXPOSITION",
  RISING_ACTION: "RISING_ACTION",
  CLIMAX: "CLIMAX",
  FALLING_ACTION: "FALLING_ACTION",
  DENOUEMENT: "DENOUEMENT",
  CODA: "CODA",
});

const THERAPY_PHASE_LABELS = Object.freeze({
  [TherapyPhase.EXTERNALIZING_PROBLEM]: "Externalizing the problem",
  [TherapyPhase.MAPPING_INFLUENCE]: "Mapping the influence",
  [TherapyPhase.FINDING_UNIQUE_OUTCOMES]: "Finding unique outcomes",
  [TherapyPhase.DECONSTRUCTING_PROBLEM_STORIES]: "Deconstructing problem stories",
  [TherapyPhase.REAUTHORING_NARRATIVE]: "Reauthoring_narrative",
});

const EXISTENTIAL_PHASE_LABELS = Object.freeze({
  [ExistentialPhase.EXISTENCE_SAFETY]: "Existence (Safety)",
  [ExistentialPhase.VALUE_CONNECTION]: "Value (Connection)",
  [ExistentialPhase.IDENTITY_AUTHENTICITY]: "Identity (Authenticity)",
  [ExistentialPhase.PURPOSE_MEANING]: "Purpose (Meaning)",
});

const NARRATIVE_PHASE_LABELS = Object.freeze({
  [NarrativePhase.EXPOSITION]: "exposition",
  [NarrativePhase.RISING_ACTION]: "rising action",
  [NarrativePhase.CLIMAX]: "climax",
  [NarrativePhase.FALLING_ACTION]: "falling action",
  [NarrativePhase.DENOUEMENT]: "denouement",
  [NarrativePhase.CODA]: "coda",
});

const DEFAULT_THERAPY_PHASE_KEY = TherapyPhase.EXTERNALIZING_PROBLEM;
const DEFAULT_EXISTENTIAL_PHASE_KEY = ExistentialPhase.EXISTENCE_SAFETY;
const DEFAULT_NARRATIVE_PHASE_KEY = NarrativePhase.EXPOSITION;

const EMPTY_SECRETS_REVEALED = Object.freeze({
  lumen: Object.freeze([]),
  umbra: Object.freeze([]),
});

/**
 * @typedef {Object} DossierSummaryTrait
 * @property {string} traitName
 * @property {string} displayValue
 * @property {number|null} confidence
 * @property {string|null} evidence
 * @property {string|null} notes
 */

/**
 * @typedef {Object} DossierSummaryForLlm
 * @property {string|null} explicitName
 * @property {DossierSummaryTrait[]} traits
 */

/**
 * @typedef {Object} DetectiveLlmView
 * @property {number} turn_count
 * @property {boolean} should_begin_closure
 * @property {"normal"|"closure"} mode
 * @property {DossierSummaryForLlm} dossier_summary
 * @property {string} therapy_phase
 * @property {string} existential_phase
 * @property {string|null} preceding_conversation_summary
 */

/**
 * @typedef {Object} PhilosopherLlmView
 * @property {number} turn_count
 * @property {boolean} should_begin_closure
 * @property {"normal"|"closure"} mode
 * @property {DossierSummaryForLlm} dossier_summary
 * @property {string} narrative_phase
 * @property {string[]} secrets_revealed
 * @property {string|null} preceding_conversation_summary
 */

/**
 * Internal server state persisted as `session.state` in durable storage.
 * This remains richer than what we share with LLMs.
 *
 * @typedef {Object} OrchestratorInternalState
 * @property {number} [turn_count]
 * @property {boolean} [should_begin_closure]
 * @property {"normal"|"closure"} [mode]
 * @property {string} [baseline_summary]
 * @property {object} [detective_xstate_snapshot]
 * @property {object} [detective_orchestration]
 * @property {string} [therapy_phase]
 * @property {string} [existential_phase]
 * @property {string} [narrative_phase]
 * @property {{ lumen?: string[], umbra?: string[] }} [secrets_revealed]
 */

module.exports = {
  MainSpeaker,
  RehydrationStatus,
  TherapyPhase,
  ExistentialPhase,
  NarrativePhase,
  THERAPY_PHASE_LABELS,
  EXISTENTIAL_PHASE_LABELS,
  NARRATIVE_PHASE_LABELS,
  DEFAULT_THERAPY_PHASE_KEY,
  DEFAULT_EXISTENTIAL_PHASE_KEY,
  DEFAULT_NARRATIVE_PHASE_KEY,
  EMPTY_SECRETS_REVEALED,
};
