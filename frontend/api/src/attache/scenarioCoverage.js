"use strict";

// Dev helper: check coverage of prompt patterns against canonical scenarios.
// Usage (from frontend/api):
//   node src/attache/scenarioCoverage.js

const { SCENARIOS } = require("./attacheScenarios");
const { computeCurrentPhaseId, createAttacheState } = require("./attacheOrchestrator");
const { getPromptPattern } = require("./attachePrompts");

function checkCoverage() {
  const results = [];

  for (const scenario of SCENARIOS) {
    let state;
    try {
      state = scenario.initState ? scenario.initState() : createAttacheState();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Error building state for scenario", scenario.id, err);
      continue;
    }

    const derivedId = state.current_phase_id || computeCurrentPhaseId(state);
    const patternFromState = getPromptPattern(state);

    // Also check the scenario's own id, in case it differs from derivedId.
    const fakeStateForScenarioId = { ...state, current_phase_id: scenario.id };
    const patternFromScenarioId = getPromptPattern(fakeStateForScenarioId);

    results.push({
      id: scenario.id,
      derivedId,
      patternFromState,
      patternFromScenarioId,
    });
  }

  let unmapped = 0;
  let idMismatch = 0;

  for (const r of results) {
    if (r.patternFromScenarioId.key === "default") {
      unmapped += 1;
      // eslint-disable-next-line no-console
      console.log("UNMAPPED SCENARIO ID:", r.id, "derivedId=", r.derivedId);
    }
    if (r.id !== r.derivedId) {
      idMismatch += 1;
      // eslint-disable-next-line no-console
      console.log("ID MISMATCH:", r.id, "derivedId=", r.derivedId, "pattern=", r.patternFromState);
    }
  }

  // eslint-disable-next-line no-console
  console.log("\nCoverage summary:");
  // eslint-disable-next-line no-console
  console.log("Total scenarios:", results.length);
  // eslint-disable-next-line no-console
  console.log("Unmapped scenario ids (patternFromScenarioId.key === 'default'):", unmapped);
  // eslint-disable-next-line no-console
  console.log("Scenario.id !== derived current_phase_id:", idMismatch);
}

if (require.main === module) {
  checkCoverage();
}

module.exports = { checkCoverage };
