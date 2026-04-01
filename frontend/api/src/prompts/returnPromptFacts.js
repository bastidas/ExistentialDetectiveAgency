"use strict";

function extractReturnPromptFacts(session, internalState) {
  const classification =
    session && session.lastReturnClassification && typeof session.lastReturnClassification === "object"
      ? session.lastReturnClassification
      : null;
  const mainState =
    internalState && internalState.mainState && typeof internalState.mainState === "object"
      ? internalState.mainState
      : null;

  const detectiveMode =
    mainState && mainState.detective && mainState.detective.mode === "closure" ? "closure" : "normal";

  return {
    returnCategory: classification && classification.returnCategory ? classification.returnCategory : "UNKNOWN",
    baselineRefreshPending: !!(classification && classification.needsBaselineRefresh),
    baselineCompleted: !!(mainState && mainState.attache && mainState.attache.baselineCompleted),
    detectiveMode,
  };
}

module.exports = {
  extractReturnPromptFacts,
};

