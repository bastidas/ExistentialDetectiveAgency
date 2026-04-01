"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { selectSpecialInstructions } = require("./instructionSelection");

describe("instructionSelection", () => {
  it("selects detective return + closure instructions deterministically", () => {
    const ids = selectSpecialInstructions("detective", {
      returnCategory: "LONG_GONE",
      detectiveMode: "closure",
    });
    assert.deepEqual(ids, ["DETECTIVE_RETURN_LONG_GONE", "DETECTIVE_CLOSURE_MODE_SOFT"]);
  });

  it("selects attache return + phase instructions", () => {
    const ids = selectSpecialInstructions("attache", {
      returnCategory: "DAY_OR_SO",
      attachePromptFamilyKey: "start_from_null",
    });
    assert.deepEqual(ids, ["ATTACHE_RETURN_DAY_OR_SO", "ATTACHE_PHASE_START_FROM_NULL"]);
  });
});

