"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPromptPreviewFromPreset } = require("./chatScenarioPreview");

test("buildPromptPreviewFromPreset: detective path includes parallel Lumen + Umbra previews", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: true,
    hasDossier: false,
  });
  assert.equal(pr.activeAgent, "detective");
  assert.ok(Array.isArray(pr.parallelPhilosophers));
  assert.equal(pr.parallelPhilosophers.length, 2);
  assert.equal(pr.parallelPhilosophers[0].activeAgent, "lumen");
  assert.equal(pr.parallelPhilosophers[1].activeAgent, "umbra");
  assert.ok(
    typeof pr.parallelPhilosophers[0].systemPrompt === "string" ||
      typeof pr.parallelPhilosophers[0].systemRoleExact === "string"
  );
});

test("buildPromptPreviewFromPreset: lab phases flow into detective + philosopher session", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: true,
    hasDossier: false,
    existentialTherapyPhase: "middle",
    narrativePhase: "Climax",
  });
  assert.equal(pr.labLlmSafeState && pr.labLlmSafeState.existential_therapy_phase, "middle");
  const umbra = pr.parallelPhilosophers && pr.parallelPhilosophers[1];
  assert.ok(umbra);
  assert.equal(umbra.labLlmSafeState && umbra.labLlmSafeState.narrative_phase, "Climax");
});

test("buildPromptPreviewFromPreset: attaché path has no parallelPhilosophers", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: false,
    hasDossier: false,
    attachePhase: "start",
  });
  assert.equal(pr.activeAgent, "attache");
  assert.equal(pr.parallelPhilosophers, undefined);
});

test("buildPromptPreviewFromPreset: attaché turnInstructionsPreview is exact slice of system prompt", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: false,
    hasDossier: false,
    attachePhase: "start",
  });
  const sys = pr.systemRoleExact != null ? pr.systemRoleExact : pr.systemPrompt;
  assert.ok(typeof sys === "string" && sys.length > 0);
  assert.equal(sys.indexOf(pr.turnInstructionsPreview) >= 0, true);
  assert.ok(pr.turnInstructionsPreview.includes("# TURN INSTRUCTIONS"));
  assert.ok(pr.turnInstructionsPreview.includes("querent"));
});

test("buildPromptPreviewFromPreset: labTurnCounts sums attaché + detective", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: true,
    hasDossier: false,
    attacheTurnCount: 2,
    detectiveTurnCount: 3,
  });
  assert.ok(pr.labTurnCounts);
  assert.equal(pr.labTurnCounts.attache_exchange_count, 2);
  assert.equal(pr.labTurnCounts.detective_turn_count, 3);
  assert.equal(pr.labTurnCounts.total_turn_count, 5);
});

test("buildPromptPreviewFromPreset: attaché path includes labTurnCounts", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: false,
    hasDossier: false,
    attachePhase: "start",
    attacheTurnCount: 4,
    detectiveTurnCount: 0,
  });
  assert.equal(pr.labTurnCounts && pr.labTurnCounts.total_turn_count, 4);
});

test("buildPromptPreviewFromPreset: attaché lab wires attacheTurnCount + phase into instruction ids (baseline mid)", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: false,
    hasDossier: false,
    attachePhase: "baseline1",
    question_index: 1,
    attacheTurnCount: 0,
    timeAwayBin: "brief",
  });
  const ids = pr.labLlmSafeState && pr.labLlmSafeState.attache_prompt_instruction_ids;
  assert.ok(Array.isArray(ids), "preview exposes attache_prompt_instruction_ids");
  assert.ok(
    ids.includes("ATTACHE_BASELINE_MID_QUESTION"),
    `expected ATTACHE_BASELINE_MID_QUESTION in ${JSON.stringify(ids)}`
  );
});

test("buildPromptPreviewFromPreset: attaché lab attacheTurnCount>=1 adds baseline delivery on start phase", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: false,
    hasDossier: false,
    attachePhase: "start",
    attacheTurnCount: 1,
    timeAwayBin: "brief",
  });
  const ids = pr.labLlmSafeState && pr.labLlmSafeState.attache_prompt_instruction_ids;
  assert.ok(Array.isArray(ids));
  assert.ok(
    ids.includes("ATTACHE_BASELINE_DELIVERY_START"),
    `expected ATTACHE_BASELINE_DELIVERY_START in ${JSON.stringify(ids)}`
  );
});

test("buildPromptPreviewFromPreset: detective timeAwayBin moderate matches catalog (not hardcoded brief)", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: true,
    hasDossier: false,
    timeAwayBin: "moderate",
  });
  const sys = pr.systemRoleExact != null ? pr.systemRoleExact : pr.systemPrompt;
  assert.ok(typeof sys === "string" && sys.length > 0);
  assert.ok(!sys.includes("### Visit context"));
  assert.ok(
    sys.includes("moderate") || sys.includes("continuation"),
    "moderate tier should surface continuation / moderate visit copy"
  );
  assert.ok(
    sys.includes("Instruction: Moderate gap with current dossier") ||
      sys.includes("moderate gap"),
    "catalog body for moderate visit should be present"
  );
});

test("buildPromptPreviewFromPreset: detectiveTurnCount >= 1 drops visit hello block", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: true,
    hasDossier: false,
    timeAwayBin: "moderate",
    detectiveTurnCount: 1,
  });
  const sys = pr.systemRoleExact != null ? pr.systemRoleExact : pr.systemPrompt;
  assert.ok(!sys.includes("### Visit context"));
  assert.ok(!sys.includes("Instruction: Moderate gap with current dossier"));
  assert.ok(sys.includes("Instruction: Stage 1"));
});

test("buildPromptPreviewFromPreset: closure penultimate when att+det = maxEx-1 (preset cap)", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: true,
    hasDossier: false,
    maxUserExchanges: 5,
    attacheTurnCount: 0,
    detectiveTurnCount: 4,
  });
  assert.equal(pr.labClosurePhase, "penultimate");
  assert.equal(pr.labMaxUserExchanges, 5);
  const sys = pr.systemRoleExact != null ? pr.systemRoleExact : pr.systemPrompt;
  assert.ok(
    sys.includes("next-to-last"),
    "penultimate closure catalog body should appear"
  );
});

test("buildPromptPreviewFromPreset: closure ultimate when att+det = maxEx (preset cap)", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: true,
    hasDossier: false,
    maxUserExchanges: 5,
    attacheTurnCount: 0,
    detectiveTurnCount: 5,
  });
  assert.equal(pr.labClosurePhase, "ultimate");
  const sys = pr.systemRoleExact != null ? pr.systemRoleExact : pr.systemPrompt;
  assert.ok(
    sys.includes("Meta-task") && sys.includes("signing off"),
    "ultimate closure catalog body should appear"
  );
  assert.ok(
    !sys.includes("Instruction: Stage 1"),
    "ultimate closure: existential therapy phase block is omitted"
  );
});

test("buildPromptPreviewFromPreset: no assistant LLM when att+det >= maxEx+1 (matches HTTP 204)", () => {
  const pr = buildPromptPreviewFromPreset({
    baselineCompleted: true,
    hasDossier: false,
    maxUserExchanges: 3,
    attacheTurnCount: 1,
    detectiveTurnCount: 3,
  });
  assert.equal(pr.noAssistantLlm, true);
  assert.equal(pr.labMaxUserExchanges, 3);
  assert.equal(pr.systemRoleExact, undefined);
  assert.equal(pr.systemPrompt, undefined);
});
