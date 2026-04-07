"use strict";

/**
 * Build a **raw** per-turn conversation slice keyed by agent.
 *
 * **Pipeline**
 * 1. `buildLlmConversationState(agentKey, { session, internalState })` — this module (session + orchestrator mirrors).
 * 2. `promptComposer.pickAllowedKeys` + `SAFE_VIEW_KEYS[agentKey]` — allowlisted subset.
 * 3. `composeAgentPrompt` exposes that subset as `llmSafeState` on the composed result.
 *
 * **Not sent to OpenAI**: `llmSafeState` is for mocks, dev lab preview, and logging. Live calls pass
 * `composed.content` (persona + instructions + catalog + custom + JSON schema appendix), and
 * chat history — see `buildChatCompletionMessages` / `chatService` detective branch.
 *
 * Allowlisted keys should stay a subset of fields produced here for each agent.
 *
 * Attaché: this function still returns routing fields for the attaché branch, but `promptComposer`
 * `SAFE_VIEW_KEYS.attache` + `pickAllowedKeys` narrow `llmSafeState` to narrative fields only
 * (`dossier_summary`, `preceding_conversation_summary`). Dev lab exposes routing via `labOrchestrationMeta`.
 *
 * @param {string} agentKey
 * @param {{ session?: object, internalState?: object }} input
 * @returns {Record<string, unknown>}
 */
function buildLlmConversationState(agentKey, { session = {}, internalState = {} }) {
  const s = session && typeof session === "object" ? session : {};
  const internal = internalState && typeof internalState === "object" ? internalState : {};
  const main = internal.mainState && typeof internal.mainState === "object" ? internal.mainState : {};

  const str = (v) => (v == null ? "" : String(v));

  const dossier_summary = str(
    s.dossier_summary ?? s.dossierSummary ?? (s.dossier && s.dossier.summary)
  );
  const preceding_conversation_summary = str(
    s.preceding_conversation_summary ?? s.precedingConversationSummary ?? s.conversation_summary
  );

  const existential_therapy_phase = str(
    s.existential_therapy_phase ??
      s.existentialTherapyPhase ??
      main.existential_therapy_phase
  );
  const ms_since_last_visit =
    typeof s.ms_since_last_visit === "number" && Number.isFinite(s.ms_since_last_visit)
      ? s.ms_since_last_visit
      : null;
  const time_away_context_line = str(s.time_away_context_line);
  const narrative_phase = str(s.narrative_phase ?? s.narrativePhase ?? main.narrative_phase);
  const secrets_revealed = str(s.secrets_revealed ?? s.secretsRevealed ?? main.secrets_revealed);

  const base = {
    dossier_summary,
    preceding_conversation_summary,
    existential_therapy_phase,
    narrative_phase,
    secrets_revealed,
  };

  if (agentKey === "attache") {
    const apids = s.attache_prompt_instruction_ids;
    return {
      dossier_summary: base.dossier_summary,
      preceding_conversation_summary: base.preceding_conversation_summary,
      visit_bin: str(s.visit_bin),
      ms_since_last_visit,
      time_away_context_line,
      dossier_stale_by_age: s.dossier_stale_by_age === true,
      temporal_greeting_mode: str(s.temporal_greeting_mode),
      attache_prompt_instruction_ids: Array.isArray(apids) ? apids : [],
    };
  }

  if (agentKey === "detective") {
    const ids = s.detective_prompt_instruction_ids;
    const dtc = s.detective_turn_count;
    const detective_turn_count =
      typeof dtc === "number" && Number.isFinite(dtc) && dtc >= 0 ? dtc : null;
    const cp = s.closure_phase;
    const closure_phase =
      cp === "penultimate" || cp === "ultimate" ? cp : null;
    return {
      dossier_summary: base.dossier_summary,
      existential_therapy_phase: base.existential_therapy_phase,
      preceding_conversation_summary: base.preceding_conversation_summary,
      visit_bin: str(s.visit_bin),
      ms_since_last_visit,
      time_away_context_line,
      temporal_greeting_mode: str(s.temporal_greeting_mode),
      detective_prompt_instruction_ids: Array.isArray(ids) ? ids : [],
      detective_turn_count,
      closure_phase,
    };
  }

  if (agentKey === "lumen" || agentKey === "umbra") {
    return {
      dossier_summary: base.dossier_summary,
      narrative_phase: base.narrative_phase,
      secrets_revealed: base.secrets_revealed,
      preceding_conversation_summary: base.preceding_conversation_summary,
    };
  }

  return base;
}

module.exports = {
  buildLlmConversationState,
};
