/**
 * Deterministic mock attaché for orchestration tests.
 *
 * Contract (architecture §4): accepts
 *   { chat_history, question_at_hand, phase_instructions, is_phase_start, next_phase_instructions }
 * and returns
 *   { user_response, user_intends_explore, user_intends_close }.
 *
 * Script: array of { user_response, user_intends_explore, user_intends_close } per turn index.
 * Each orchestrator turn consumes the next script entry. If script is exhausted, returns a default.
 */

const DEFAULT_RESPONSE = {
  user_response: "",
  user_intends_explore: false,
  user_intends_close: false,
};

/**
 * Creates a mock attaché that returns scripted responses per turn.
 *
 * @param {Array<{ user_response: string, user_intends_explore: boolean, user_intends_close: boolean }>} script
 *   One entry per turn (index 0, 1, 2, ...). Each call consumes the next entry.
 * @param {{ user_response?: string, user_intends_explore?: boolean, user_intends_close?: boolean }} fallback
 *   Used when script runs out (optional).
 * @returns {Promise<{ user_response: string, user_intends_explore: boolean, user_intends_close: boolean }>}
 *   Async function that accepts attaché input and returns the scripted output for the current turn index.
 */
function createMockAttache(script, fallback = {}) {
  let turnIndex = 0;
  const defaultOut = { ...DEFAULT_RESPONSE, ...fallback };

  return async function callAttache(input) {
    const out = script[turnIndex] != null ? { ...DEFAULT_RESPONSE, ...script[turnIndex] } : defaultOut;
    turnIndex += 1;
    return out;
  };
}

/**
 * Resets the turn index of a mock created by createMockAttache so the same script can be reused
 * (e.g. for a new test). Only works if the mock stores turnIndex in a shared closure; our implementation
 * does, but the caller gets the async function only. So tests that need a fresh script should create
 * a new mock with createMockAttache(script) per test.
 */

/**
 * Creates a mock attaché that records all invocations (input + turn index) for assertions.
 * Still returns from script; script can be empty and fallback used for every call.
 *
 * @param {Array<{ user_response: string, user_intends_explore: boolean, user_intends_close: boolean }>} script
 * @param {{ user_response?: string, user_intends_explore?: boolean, user_intends_close?: boolean }} fallback
 * @returns {{ callAttache: (...args) => Promise<...>, invocations: Array<{ turnIndex: number, input: object }> }}
 */
function createRecordingMockAttache(script, fallback = {}) {
  let turnIndex = 0;
  const invocations = [];
  const defaultOut = { ...DEFAULT_RESPONSE, ...fallback };

  async function callAttache(input) {
    invocations.push({ turnIndex, input: { ...input } });
    const out = script[turnIndex] != null ? { ...DEFAULT_RESPONSE, ...script[turnIndex] } : defaultOut;
    turnIndex += 1;
    return out;
  }

  return { callAttache, invocations };
}

module.exports = {
  createMockAttache,
  createRecordingMockAttache,
  DEFAULT_RESPONSE,
};
