"use strict";

/**
 * Node helpers for building JSON bodies. Canonical schema: `./chat-http.contract.json` (same folder).
 * In dev, that JSON is served at GET `/contracts/chat-http.contract.json` (see server.js).
 *
 * `envelope` values are filled by `api/src/orchestration/chatMachine.js`, not here.
 */

const CHAT_HTTP_CONTRACT = require("./chat-http.contract.json");

/**
 * @typedef {("attache"|"detective")} ActiveAgent
 * @typedef {{ active_agent: ActiveAgent, baseline_completed: boolean, agent_label: string, has_dossier: boolean }} ChatEnvelope
 * @typedef {{ userExchanges: number, maxUserExchanges: number, dailyUsage: number, maxDailyUsage: number }} ChatDebugCounters
 * @typedef {{ reply: string, envelope: ChatEnvelope, debug?: ChatDebugCounters, closureUltimate?: boolean, lumenUserResponse?: string, lumenOtherResponse?: string, lumenNotes?: string[], lumenCallouts?: unknown[], umbraUserResponse?: string, umbraOtherResponse?: string, umbraNotes?: string[], umbraCallouts?: unknown[], philosopherNotes?: string[], llmRefusal?: { agentKey: string, refusalText: string, model?: string, responseId?: string } | Array<{ agentKey: string, refusalText: string, model?: string, responseId?: string }> }} ChatPostSuccessBody
 * @typedef {{ error: string, errorKind?: string }} ChatPostErrorBody
 * @typedef {{ orchestration_user_turn_count: number, detective_turn_count: number }} ChatOrchestrationCounters
 * @typedef {{ transcriptMode?: 'full'|'hidden', skipEmptyChatBootstrap?: boolean, serverRetainsHistory?: boolean }} ChatStateResumeUi
 * @typedef {{ messages: Array<{role:string,text:string,agent?:string,kind?:string}>, envelope: ChatEnvelope, userProgress: object, detectiveIntroSent?: boolean, orchestration?: ChatOrchestrationCounters, resumeUi?: ChatStateResumeUi|null }} ChatStateSnapshotBody
 */

const OPTIONAL_CHAT_SUCCESS_KEYS = [
  "lumenUserResponse",
  "lumenOtherResponse",
  "lumenNotes",
  "lumenCallouts",
  "umbraUserResponse",
  "umbraOtherResponse",
  "umbraNotes",
  "umbraCallouts",
  "philosopherNotes",
  /** Set when this response used `DETECTIVE_CLOSURE_ULTIMATE` (final scripted reply); client may show closing stamp. */
  "closureUltimate",
  // Raw model refusal when assistant message had `refusal` (log in devtools, not user-facing).
  "llmRefusal",
];

/**
 * @param {{ reply: string, envelope: ChatEnvelope, debug?: ChatDebugCounters } & Record<string, unknown>} fields
 * @returns {ChatPostSuccessBody}
 */
function createChatPostSuccessBody(fields) {
  if (!fields || !fields.envelope) {
    throw new Error("chatApiContract: envelope must be supplied by the orchestration machine");
  }
  const body = {
    reply: fields.reply ?? "",
    envelope: fields.envelope,
  };
  if (fields.debug) {
    body.debug = fields.debug;
  }
  for (const k of OPTIONAL_CHAT_SUCCESS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(fields, k) && fields[k] !== undefined) {
      body[k] = fields[k];
    }
  }
  return body;
}

/**
 * @param {Pick<ChatPostErrorBody, "error"> & Partial<ChatPostErrorBody>} fields
 * @returns {ChatPostErrorBody}
 */
function buildChatPostErrorBody(fields) {
  return {
    errorKind: "bad_request",
    ...fields,
  };
}

/**
 * @param {Partial<ChatStateSnapshotBody> & { envelope: ChatEnvelope }} fields
 * @returns {ChatStateSnapshotBody}
 */
function createChatStateSnapshotBody(fields) {
  if (!fields || !fields.envelope) {
    throw new Error("chatApiContract: chat-state snapshot requires envelope from orchestration");
  }
  const defaults = {
    messages: [],
    userProgress: {
      baselineCompleted: !!fields.envelope.baseline_completed,
      pendingBaselineRefresh: false,
      returningPersisted: false,
    },
    detectiveIntroSent: false,
    resumeUi: null,
  };
  const merged = {
    ...defaults,
    ...fields,
    envelope: fields.envelope,
    userProgress: { ...defaults.userProgress, ...(fields.userProgress || {}) },
  };
  if (!Array.isArray(merged.messages)) {
    merged.messages = [];
  }
  return merged;
}

module.exports = {
  CHAT_HTTP_CONTRACT,
  createChatPostSuccessBody,
  buildChatPostErrorBody,
  createChatStateSnapshotBody,
};
