"use strict";

function normalizeReturnCategory(value) {
  const raw = value == null ? "" : String(value).trim().toUpperCase();
  if (!raw) return "UNKNOWN";
  return raw;
}

function selectDetectiveInstructions(facts) {
  const selected = [];
  const category = normalizeReturnCategory(facts.returnCategory);
  if (category === "JUST_STEPPED_AWAY") {
    selected.push("DETECTIVE_RETURN_BRIEF");
  } else if (category === "DAY_OR_SO") {
    selected.push("DETECTIVE_RETURN_DAY_OR_SO");
  } else if (category === "LONG_GONE") {
    selected.push("DETECTIVE_RETURN_LONG_GONE");
  } else {
    selected.push("DETECTIVE_RETURN_UNKNOWN");
  }
  if (facts.detectiveMode === "closure") {
    selected.push("DETECTIVE_CLOSURE_MODE_SOFT");
  }
  return selected;
}

function selectAttacheInstructions(facts) {
  const selected = [];
  const category = normalizeReturnCategory(facts.returnCategory);
  if (category === "DAY_OR_SO") {
    selected.push("ATTACHE_RETURN_DAY_OR_SO");
  } else if (category === "LONG_GONE") {
    selected.push("ATTACHE_RETURN_LONG_GONE");
  }

  if (facts.attachePromptFamilyKey === "start_from_null") {
    selected.push("ATTACHE_PHASE_START_FROM_NULL");
  } else if (facts.attachePromptFamilyKey === "baseline_from_mid_baseline") {
    selected.push("ATTACHE_PHASE_BASELINE_FROM_MID_BASELINE");
  }
  return selected;
}

function selectSpecialInstructions(agentKey, facts) {
  if (agentKey === "detective" || agentKey === "final_detective") {
    return selectDetectiveInstructions(facts);
  }
  if (agentKey === "attache") {
    return selectAttacheInstructions(facts);
  }
  return [];
}

module.exports = {
  selectSpecialInstructions,
};

