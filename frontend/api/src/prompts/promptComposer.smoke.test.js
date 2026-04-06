"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  composeAgentPrompt,
  buildDetectiveTurnInstructionBlock,
  SAFE_VIEW_KEYS,
  resolveCustomSegment,
} = require("./promptComposer");
const { buildAgentTurn } = require("./turnBuilderRegistry");
const { computeDetectiveCatalogInstructionIds } = require("../detective/detectivePromptPolicy");
const { formatMockQueryLine } = require("../agents/mockAgentTurn");
const { getPromptRegistryEntry } = require("./promptRegistry");

test("composeAgentPrompt(attache) loads registry files and returns llmSafeState", () => {
  const out = composeAgentPrompt({
    agentKey: "attache",
    session: { dossier_summary: "x", preceding_conversation_summary: "y" },
    internalState: {},
    attacheTurnInstruction: { turnInstruction: "Turn note.", attachePromptFamilyKey: null },
  });
  assert.equal(typeof out.content, "string");
  assert.ok(out.content.length > 0);
  assert.ok(out.content.includes("Turn note."));
  assert.ok(out.llmSafeState && typeof out.llmSafeState === "object");
  assert.equal(out.role, "system");
  assert.ok(out.structuredOutputsResponseFormat);
  assert.equal(out.structuredOutputsResponseFormat.type, "json_schema");
  assert.equal(out.structuredOutputsResponseFormat.json_schema.strict, true);
  assert.equal(out.structuredOutputsResponseFormat.json_schema.name, "attache_turn");
});

test("composeAgentPrompt(detective) exposes Structured Outputs response_format", () => {
  const out = composeAgentPrompt({
    agentKey: "detective",
    session: {},
    internalState: {},
  });
  assert.ok(out.structuredOutputsResponseFormat);
  assert.equal(out.structuredOutputsResponseFormat.json_schema.name, "detective_turn");
  assert.equal(
    out.structuredOutputsResponseFormat.json_schema.schema.additionalProperties,
    false
  );
});

test("composeAgentPrompt(attache) uses custom over legacy turnInstruction", () => {
  const out = composeAgentPrompt({
    agentKey: "attache",
    session: {},
    internalState: {},
    custom: "Custom segment.",
    attacheTurnInstruction: { turnInstruction: "Ignored.", attachePromptFamilyKey: null },
  });
  assert.ok(out.content.includes("Custom segment."));
  assert.ok(!out.content.includes("Ignored."));
});

test("resolveCustomSegment prefers custom", () => {
  assert.equal(
    resolveCustomSegment("A", { turnInstruction: "B" }),
    "A"
  );
  assert.equal(resolveCustomSegment("", { turnInstruction: "B" }), "B");
  assert.equal(resolveCustomSegment(null, { turnInstruction: "B" }), "B");
});

test("formatMockQueryLine matches persona + instructions + schema + *custom*", () => {
  const entry = getPromptRegistryEntry("attache");
  assert.ok(entry);
  const line = formatMockQueryLine("attache", "hello custom");
  assert.ok(line.includes(path.basename(entry.personaPath)));
  assert.ok(line.includes(path.basename(entry.instructionsPath)));
  assert.ok(line.includes(path.basename(entry.outputSchemaPath)));
  assert.ok(line.includes("*hello custom*"));
});

test("SAFE_VIEW_KEYS lists attache keys", () => {
  assert.ok(Array.isArray(SAFE_VIEW_KEYS.attache));
  assert.ok(SAFE_VIEW_KEYS.attache.includes("dossier_summary"));
});

test("computeDetectiveCatalogInstructionIds: closure_phase overrides visit_bin", () => {
  assert.deepEqual(
    computeDetectiveCatalogInstructionIds({
      closure_phase: "penultimate",
      visit_bin: "moderate",
    }),
    ["DETECTIVE_CLOSURE_PENULTIMATE"]
  );
  assert.deepEqual(
    computeDetectiveCatalogInstructionIds({
      closure_phase: "ultimate",
      visit_bin: "brief",
    }),
    ["DETECTIVE_CLOSURE_ULTIMATE"]
  );
});

test("composeAgentPrompt(detective) first turn: no telemetry; brief bin has no return-instruction block", () => {
  const session = {
    detective_turn_count: 0,
    detective_first_turn: true,
    existential_therapy_phase: "initial",
    random_opening_line: "x",
    visit_bin: "brief",
    ms_since_last_visit: 120000,
    temporal_greeting_mode: "none",
    dossier_stale_by_age: false,
    time_away_context_line: "Time-away: brief — short gap",
    lastReturnClassification: { returnCategory: "JUST_STEPPED_AWAY" },
  };
  const composed = composeAgentPrompt({ agentKey: "detective", session, internalState: {} });
  assert.ok(!composed.content.includes("### Visit context"));
  assert.ok(!composed.content.includes("Orchestrator summary"));
  assert.ok(!composed.content.includes("ms_since_last_visit"));
  assert.ok(
    !composed.content.includes("Instruction: Moderate gap") &&
      composed.content.includes("Instruction: Stage 1"),
    "visit_bin brief: DETECTIVE_RETURN_BRIEF has empty title/body—no moderate return block; therapy still applies"
  );
  assert.ok(
    composed.content.includes("### Scene guidance"),
    "brief + first turn + no dossier: opening scene guidance is injected"
  );
  assert.ok(composed.llmSafeState && composed.llmSafeState.visit_bin === "brief");
});

test("composeAgentPrompt(detective) omits visit timing + return catalog after first detective turn", () => {
  const session = {
    detective_turn_count: 1,
    detective_first_turn: false,
    existential_therapy_phase: "initial",
    visit_bin: "moderate",
    ms_since_last_visit: 58_050_000,
    temporal_greeting_mode: "continuation",
    dossier_stale_by_age: false,
    time_away_context_line: "Time-away: moderate",
    lastReturnClassification: { returnCategory: "DAY_OR_SO" },
  };
  const composed = composeAgentPrompt({ agentKey: "detective", session, internalState: {} });
  assert.ok(!composed.content.includes("### Visit context"));
  assert.ok(!composed.content.includes("Instruction: Moderate gap with current dossier"));
  assert.ok(composed.content.includes("Instruction: Stage 1"));
  assert.ok(!composed.content.includes("### Scene guidance"));
});

test("buildAgentTurn(detective) matches compose: brief first turn + therapy + scene (no dossier)", () => {
  const session = {
    detective_turn_count: 0,
    detective_first_turn: true,
    existential_therapy_phase: "initial",
    random_opening_line: "Fixed opening line for test.",
    visit_bin: "brief",
    temporal_greeting_mode: "none",
    dossier_stale_by_age: false,
    lastReturnClassification: { returnCategory: "JUST_STEPPED_AWAY" },
  };
  const fromRegistry = buildAgentTurn({ agentKey: "detective", session, internalState: {} }).custom;
  const fromComposer = buildDetectiveTurnInstructionBlock(session, {});
  assert.equal(fromRegistry, fromComposer);
  assert.ok(fromComposer.includes("### Scene guidance"));
  assert.ok(fromComposer.includes("Instruction: Stage 1"));
  assert.ok(fromComposer.includes("Fixed opening line for test."));
  assert.ok(!fromComposer.includes("Instruction: Moderate gap"));
  const composed = composeAgentPrompt({ agentKey: "detective", session, internalState: {} });
  assert.ok(composed.content.includes("Instruction: Stage 1"));
  assert.ok(composed.llmSafeState && composed.llmSafeState.visit_bin === "brief");
});

test("composeAgentPrompt(detective): moderate first turn injects return block but not Scene guidance", () => {
  const session = {
    detective_turn_count: 0,
    detective_first_turn: true,
    existential_therapy_phase: "initial",
    visit_bin: "moderate",
    temporal_greeting_mode: "continuation",
    dossier_stale_by_age: false,
    lastReturnClassification: { returnCategory: "DAY_OR_SO" },
  };
  const composed = composeAgentPrompt({ agentKey: "detective", session, internalState: {} });
  assert.ok(composed.content.includes("Instruction: Moderate gap with current dossier"));
  assert.ok(!composed.content.includes("### Scene guidance"));
});

test("composeAgentPrompt(detective): brief first turn with dossier omits Scene guidance", () => {
  const session = {
    detective_turn_count: 0,
    detective_first_turn: true,
    existential_therapy_phase: "initial",
    visit_bin: "brief",
    dossier_summary: "Name: Test User.",
    temporal_greeting_mode: "none",
    dossier_stale_by_age: false,
    lastReturnClassification: { returnCategory: "JUST_STEPPED_AWAY" },
  };
  const composed = composeAgentPrompt({ agentKey: "detective", session, internalState: {} });
  assert.ok(!composed.content.includes("### Scene guidance"));
});

test("composeAgentPrompt(detective): closure ultimate omits existential therapy block", () => {
  const session = {
    detective_turn_count: 5,
    detective_first_turn: false,
    existential_therapy_phase: "middle",
    closure_phase: "ultimate",
    detective_prompt_instruction_ids: ["DETECTIVE_CLOSURE_ULTIMATE"],
    visit_bin: "brief",
  };
  const composed = composeAgentPrompt({ agentKey: "detective", session, internalState: {} });
  assert.ok(
    composed.content.includes("Meta-task") && composed.content.includes("signing off"),
    "ultimate closure catalog body is present"
  );
  assert.ok(!composed.content.includes("Instruction: Stage 2"));
  assert.ok(!composed.content.includes("Instruction: Stage 1"));
});

test("composeAgentPrompt(detective): closure penultimate still includes existential therapy block", () => {
  const session = {
    detective_turn_count: 4,
    detective_first_turn: false,
    existential_therapy_phase: "initial",
    closure_phase: "penultimate",
    detective_prompt_instruction_ids: ["DETECTIVE_CLOSURE_PENULTIMATE"],
    visit_bin: "brief",
  };
  const composed = composeAgentPrompt({ agentKey: "detective", session, internalState: {} });
  assert.ok(composed.content.includes("next-to-last"));
  assert.ok(composed.content.includes("Instruction: Stage 1"));
});
