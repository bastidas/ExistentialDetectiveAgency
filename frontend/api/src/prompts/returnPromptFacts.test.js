"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractReturnPromptFacts } = require("./returnPromptFacts");

describe("returnPromptFacts", () => {
  it("reads return category and closure mode from session + mainState", () => {
    const out = extractReturnPromptFacts(
      { lastReturnClassification: { returnCategory: "DAY_OR_SO", needsBaselineRefresh: true } },
      { mainState: { detective: { mode: "closure" }, attache: { baselineCompleted: true } } }
    );
    assert.equal(out.returnCategory, "DAY_OR_SO");
    assert.equal(out.baselineRefreshPending, true);
    assert.equal(out.baselineCompleted, true);
    assert.equal(out.detectiveMode, "closure");
  });
});

