"use strict";

/**
 * Policy persistence lives on [`detectiveMachine`](./detectiveMachine.js) (`POLICY_TURN` + `instructionIds`).
 * Re-export orchestrator helpers from [`detectiveExistentialSession`](./detectiveExistentialSession.js).
 */
const {
  runDetectivePromptPolicyTurn,
  clearDetectivePromptPolicySnapshot,
} = require("./detectiveExistentialSession");

module.exports = {
  runDetectivePromptPolicyTurn,
  clearDetectivePromptPolicySnapshot,
};
