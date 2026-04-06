"use strict";

/**
 * First user message handled as detective after attaché handoff (`detective_turn_count === 0`).
 * Visit-timing prose and `DETECTIVE_RETURN_*` catalog rows apply only when this is true.
 * Scene guidance (`DETECTIVE_SCENE_GUIDANCE_FIRST`) uses stricter rules in `detectivePrompts.js` (brief bin + no dossier + first turn).
 *
 * @param {Record<string, unknown>|null|undefined} session
 * @returns {boolean}
 */
function isDetectiveSessionFirstTurn(session) {
  const s = session && typeof session === "object" ? session : {};
  if (s.detective_first_turn === true) return true;
  if (s.detective_first_turn === false) return false;
  if (typeof s.detective_turn_count === "number") return s.detective_turn_count === 0;
  return true;
}

module.exports = {
  isDetectiveSessionFirstTurn,
};
