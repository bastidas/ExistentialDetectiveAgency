"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractTurnInstructionsFromSystemPrompt,
  extractFromTurnInstructionsHeadingThroughEnd,
} = require("./turnInstructionsExtract");

test("extractTurnInstructions: empty when marker missing", () => {
  assert.equal(extractTurnInstructionsFromSystemPrompt("hello"), "");
});

test("extractTurnInstructions: stops at next top-level H1", () => {
  const sys = [
    "# Identity",
    "foo",
    "# TURN INSTRUCTIONS",
    "### Visit context",
    "stay under",
    "## Sub",
    "more",
    "# Response format",
    "tail",
  ].join("\n");
  const out = extractTurnInstructionsFromSystemPrompt(sys);
  assert.ok(out.includes("# TURN INSTRUCTIONS"));
  assert.ok(out.includes("### Visit context"));
  assert.ok(!out.includes("# Response format"));
});

test("extractTurnInstructions: single block only", () => {
  const sys = "# TURN INSTRUCTIONS\nonly line\n";
  assert.equal(extractTurnInstructionsFromSystemPrompt(sys), "# TURN INSTRUCTIONS\nonly line");
});

test("extractTurnInstructions: ignores quoted substring before real heading (attaché instructions)", () => {
  const sys = [
    "# GENERAL INSTRUCTIONS",
    '- **user_response** (string) – follow the "# TURN INSTRUCTIONS" when given.',
    "- **user_intends_explore** (boolean) – …",
    "",
    "# TURN INSTRUCTIONS",
    "The querent is just arriving.",
    "",
    "# Response format",
    "schema",
  ].join("\n");
  const out = extractTurnInstructionsFromSystemPrompt(sys);
  assert.ok(out.startsWith("# TURN INSTRUCTIONS\n"));
  assert.ok(out.includes("The querent is just arriving"));
  assert.ok(!out.includes("user_intends_explore"));
  assert.ok(!out.includes("# Response format"));
});

test("extractThroughEnd: includes everything after # TURN INSTRUCTIONS to EOF (next H1 does not truncate)", () => {
  const sys = [
    "# Identity",
    "foo",
    "# TURN INSTRUCTIONS",
    "### Visit context",
    "stay under",
    "# Response format",
    "Reply with JSON only.",
    "",
    "more tail",
  ].join("\n");
  const out = extractFromTurnInstructionsHeadingThroughEnd(sys);
  assert.ok(out.startsWith("# TURN INSTRUCTIONS\n"));
  assert.ok(out.includes("# Response format"));
  assert.ok(out.includes("more tail"));
  assert.ok(!out.includes("# Identity"));
});

test("extractThroughEnd: empty when heading missing", () => {
  assert.equal(extractFromTurnInstructionsHeadingThroughEnd("no marker"), "");
});
