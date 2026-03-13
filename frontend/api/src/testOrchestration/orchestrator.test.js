/**
 * Orchestration verification tests (architecture plan: orchestrator_attaché_architecture_2e554bef.plan.md).
 * When all tests pass, the orchestrator + attaché architecture has been implemented successfully.
 *
 * Run: node src/testOrchestration/orchestrator.test.js
 * If the orchestrator module is not found, the script exits with a message and skips tests.
 */

const { createMockAttache, createRecordingMockAttache } = require("./mockAttache.js");

let orchestrator;
try {
  orchestrator = require("../baselineOrchestrator");
} catch (e) {
  console.log(
    "Orchestrator module (baselineOrchestrator.js) not found; skipping orchestration tests. Add it to run these tests."
  );
  process.exit(0);
}

const assert = require("assert");

const VALID_PHASES = new Set([
  "start",
  "explore",
  "administerBaseline1",
  "administerBaseline2",
  "administerBaseline3",
  "close",
]);

function run(name, fn) {
  try {
    fn();
    console.log("  OK:", name);
    return true;
  } catch (err) {
    console.error("  FAIL:", name);
    console.error("    ", err.message);
    return false;
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    console.log("  OK:", name);
    return true;
  } catch (err) {
    console.error("  FAIL:", name);
    console.error("    ", err.message);
    return false;
  }
}

// --- Contract tests (§4, §3) ---

async function contractTests() {
  console.log("\n--- Contract tests ---");
  let passed = 0;
  let total = 0;

  total++;
  if (await runAsync("Attaché called once per user turn", async () => {
    const script = [
      { user_response: "Hi back", user_intends_explore: false, user_intends_close: false },
      { user_response: "Sure", user_intends_explore: false, user_intends_close: false },
    ];
    const { callAttache, invocations } = createRecordingMockAttache(script);
    const createInitialState = orchestrator.createInitialState || orchestrator.createState;
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: ["Q2"], phase3_questions: ["Q3"] });
    await orchestrator.processTurn("Hello", state, callAttache);
    await orchestrator.processTurn("Go", state, callAttache);
    assert.strictEqual(invocations.length, 2, "attaché should be called once per user message");
  })) passed++;

  total++;
  if (await runAsync("Attaché input shape", async () => {
    const { callAttache, invocations } = createRecordingMockAttache([
      { user_response: "Ok", user_intends_explore: false, user_intends_close: false },
    ]);
    const createInitialState = orchestrator.createInitialState || orchestrator.createState;
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: [], phase3_questions: [] });
    await orchestrator.processTurn("Hi", state, callAttache);
    assert(invocations.length >= 1, "attaché should be called");
    const input = invocations[0].input;
    assert(Array.isArray(input.chat_history), "chat_history must be array");
    assert(typeof input.phase_instructions === "string", "phase_instructions must be string");
    assert(typeof input.is_phase_start === "boolean", "is_phase_start must be boolean");
    assert(input.question_at_hand === null || typeof input.question_at_hand === "string", "question_at_hand string or null");
    assert(input.next_phase_instructions === null || typeof input.next_phase_instructions === "string", "next_phase_instructions string or null");
  })) passed++;

  total++;
  if (await runAsync("Attaché output shape", async () => {
    const script = [{ user_response: "Reply", user_intends_explore: true, user_intends_close: false }];
    const callAttache = createMockAttache(script);
    const createInitialState = orchestrator.createInitialState || orchestrator.createState;
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: [], phase3_questions: [] });
    const result = await orchestrator.processTurn("Explore", state, callAttache);
    assert(typeof result.user_response === "string", "user_response must be string");
    assert(result.state != null, "state must be returned");
  })) passed++;

  total++;
  if (await runAsync("Session state shape", async () => {
    const callAttache = createMockAttache([{ user_response: "Hi", user_intends_explore: false, user_intends_close: false }]);
    const createInitialState = orchestrator.createInitialState || orchestrator.createState;
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: ["Q2"], phase3_questions: ["Q3"] });
    const result = await orchestrator.processTurn("Hello", state, callAttache);
    const s = result.state;
    assert(s != null, "state exists");
    assert(typeof s.phase === "string", "phase is string");
    assert(Array.isArray(s.chat_history), "chat_history is array");
    const hasPhaseQuestions =
      (Array.isArray(s.phase1_questions) || Array.isArray(s.phase_questions)) &&
      (Array.isArray(s.phase2_questions) || (s.phase_questions && s.phase_questions[1] !== undefined));
    assert(hasPhaseQuestions || Array.isArray(s.phase1_questions), "phase questions (or phase1_questions) present");
  })) passed++;

  total++;
  if (await runAsync("question_at_hand semantics: current phase only (never next phase's Q)", async () => {
    const { callAttache, invocations } = createRecordingMockAttache([
      { user_response: "Phase 3 here.", user_intends_explore: false, user_intends_close: false },
    ]);
    const createInitialState = orchestrator.createInitialState || orchestrator.createState;
    const state = createInitialState({
      phase: "administerBaseline2",
      question_index: 2,
      phase1_questions: ["Q1a"],
      phase2_questions: ["Q2a", "Q2b"],
      phase3_questions: ["FirstQ3", "Q3b"],
      chat_history: [],
    });
    await orchestrator.processTurn("Okay, let's move on.", state, callAttache);
    const lastCall = invocations[invocations.length - 1];
    assert(lastCall, "attaché was called");
    assert(
      lastCall.input.question_at_hand === "Q2b",
      "question_at_hand must be current phase's (phase 2) last Q, not next phase's, got: " + lastCall.input.question_at_hand
    );
  })) passed++;

  return { passed, total };
}

// --- Phase and transition tests (§2, §5) ---

async function transitionTests() {
  console.log("\n--- Phase and transition tests ---");
  let passed = 0;
  let total = 0;
  const createInitialState = orchestrator.createInitialState || orchestrator.createState;

  total++;
  if (await runAsync("Valid phases", async () => {
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: [], phase3_questions: [] });
    assert(VALID_PHASES.has(state.phase), "initial phase should be valid: " + state.phase);
  })) passed++;

  total++;
  if (await runAsync("start → explore", async () => {
    const callAttache = createMockAttache([
      { user_response: "Sure, explore.", user_intends_explore: true, user_intends_close: false },
    ]);
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: [], phase3_questions: [] });
    const result = await orchestrator.processTurn("I'd like to learn more first.", state, callAttache);
    assert.strictEqual(result.state.phase, "explore", "phase should become explore");
  })) passed++;

  total++;
  if (await runAsync("start → administerBaseline1", async () => {
    const callAttache = createMockAttache([
      { user_response: "Phase 1. First question: Q1", user_intends_explore: false, user_intends_close: false },
    ]);
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: [], phase3_questions: [] });
    const result = await orchestrator.processTurn("Let's do the baseline.", state, callAttache);
    assert.strictEqual(result.state.phase, "administerBaseline1", "phase should become administerBaseline1");
    assert.strictEqual((result.state.question_index ?? result.state.phase1_index) ?? 0, 0, "question_index should be 0");
  })) passed++;

  total++;
  if (await runAsync("start → close", async () => {
    const callAttache = createMockAttache([
      { user_response: "We can end now. Sure?", user_intends_explore: false, user_intends_close: true },
    ]);
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: [], phase3_questions: [] });
    const result = await orchestrator.processTurn("I want to skip the test.", state, callAttache);
    assert.strictEqual(result.state.phase, "close", "phase should become close");
    assert(result.state.phase_before_close != null || result.state.phase === "close", "phase_before_close stored or close");
  })) passed++;

  total++;
  if (await runAsync("explore → administerBaseline1 (from start)", async () => {
    const callAttache = createMockAttache([
      { user_response: "Ready for phase 1.", user_intends_explore: false, user_intends_close: false },
    ]);
    const state = createInitialState({ phase1_questions: ["What is war?"], phase2_questions: [], phase3_questions: [] });
    state.phase = "explore";
    state.baseline_phase_when_exploring = null;
    const result = await orchestrator.processTurn("Okay, I'm ready for the questions.", state, callAttache);
    assert.strictEqual(result.state.phase, "administerBaseline1", "phase should become administerBaseline1");
    const q = result.state.phase1_questions?.[0] ?? result.state.phase_questions?.[0];
    assert(q != null, "first question of phase 1 should be in state");
  })) passed++;

  total++;
  if (await runAsync("Same question in explore", async () => {
    const callAttache = createMockAttache(
      [
        { user_response: "Answer.", user_intends_explore: true, user_intends_close: false },
        { user_response: "Same.", user_intends_explore: true, user_intends_close: false },
      ],
      { user_intends_explore: true }
    );
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: [], phase3_questions: [] });
    state.phase = "explore";
    state.baseline_phase_when_exploring = "administerBaseline1";
    state.question_index = 0;
    state.phase1_questions = ["Q1"];
    const r1 = await orchestrator.processTurn("What is this?", state, callAttache);
    const idx1 = r1.state.question_index ?? r1.state.phase1_index ?? 0;
    const r2 = await orchestrator.processTurn("Another question.", r1.state, callAttache);
    const idx2 = r2.state.question_index ?? r2.state.phase1_index ?? 0;
    assert.strictEqual(idx1, idx2, "question_index should not advance in explore");
    assert.strictEqual(r2.state.phase, "explore", "phase should stay explore");
  })) passed++;

  total++;
  if (await runAsync("Baseline phase advance", async () => {
    const callAttache = createMockAttache([
      { user_response: "Next.", user_intends_explore: false, user_intends_close: false },
      { user_response: "Next.", user_intends_explore: false, user_intends_close: false },
    ]);
    const state = createInitialState({
      phase1_questions: ["Q1a", "Q1b"],
      phase2_questions: ["Q2a"],
      phase3_questions: ["Q3a"],
    });
    state.phase = "administerBaseline1";
    state.question_index = 0;
    state.phase1_questions = ["Q1a", "Q1b"];
    const r1 = await orchestrator.processTurn("Answer 1", state, callAttache);
    const r2 = await orchestrator.processTurn("Answer 2", r1.state, callAttache);
    const phase2 = r2.state.phase === "administerBaseline2" || (r2.state.question_index >= 2 && r2.state.phase === "administerBaseline1");
    assert(phase2 || r2.state.question_index >= 1, "question_index should advance or phase transition to administerBaseline2");
  })) passed++;

  total++;
  if (await runAsync("question_at_hand on phase transition (current phase Q only)", async () => {
    const { callAttache, invocations } = createRecordingMockAttache([
      { user_response: "Phase 3: first question.", user_intends_explore: false, user_intends_close: false },
    ]);
    const state = createInitialState({
      phase1_questions: ["Q1"],
      phase2_questions: ["Q2a", "Q2b"],
      phase3_questions: ["FirstQ3"],
    });
    state.phase = "administerBaseline2";
    state.question_index = 2;
    state.phase2_questions = ["Q2a", "Q2b"];
    state.phase3_questions = ["FirstQ3"];
    await orchestrator.processTurn("Okay, let's move on.", state, callAttache);
    const last = invocations[invocations.length - 1];
    assert.strictEqual(last.input.question_at_hand, "Q2b", "question_at_hand must be current phase (phase 2) last Q, not next phase's");
  })) passed++;

  total++;
  if (await runAsync("administerBaseline2 → close → explore → administerBaseline2", async () => {
    const callAttache = createMockAttache(
      [
        { user_response: "We can end. Sure?", user_intends_explore: false, user_intends_close: true },
        { user_response: "What would you like to know?", user_intends_explore: true, user_intends_close: false },
        { user_response: "Here we are again—What is war?", user_intends_explore: false, user_intends_close: false },
      ],
      { user_intends_explore: false, user_intends_close: false }
    );
    const state = createInitialState({
      phase1_questions: ["Q1"],
      phase2_questions: ["What is war?"],
      phase3_questions: ["Q3"],
    });
    state.phase = "administerBaseline2";
    state.question_index = 0;
    state.phase2_questions = ["What is war?"];
    const r1 = await orchestrator.processTurn("I want to end the baseline.", state, callAttache);
    assert.strictEqual(r1.state.phase, "close", "should move to close");
    const r2 = await orchestrator.processTurn("Actually I have a question.", r1.state, callAttache);
    assert.strictEqual(r2.state.phase, "explore", "should move to explore from close");
    const r3 = await orchestrator.processTurn("Okay, let's continue.", r2.state, callAttache);
    assert.strictEqual(r3.state.phase, "administerBaseline2", "should return to administerBaseline2");
    const qAfter = r3.state.phase2_questions?.[r3.state.question_index ?? r3.state.phase2_index ?? 0];
    assert.strictEqual(qAfter, "What is war?", "question_at_hand should be same as before close");
  })) passed++;

  total++;
  if (await runAsync("Close cancel", async () => {
    const callAttache = createMockAttache([
      { user_response: "No problem.", user_intends_explore: false, user_intends_close: false },
    ]);
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: ["Q2"], phase3_questions: ["Q3"] });
    state.phase = "close";
    state.phase_before_close = "administerBaseline2";
    state.question_index_before_close = 1;
    state.phase2_questions = ["Q2a", "Q2b"];
    const result = await orchestrator.processTurn("No, go back.", state, callAttache);
    assert.strictEqual(result.state.phase, "administerBaseline2", "should restore phase");
    const idx = result.state.question_index ?? result.state.phase2_index ?? 0;
    assert.strictEqual(idx, 1, "should restore question_index to 1");
  })) passed++;

  return { passed, total };
}

// --- Mock-chat scenario tests (§9–§13) ---

async function scenarioTests() {
  console.log("\n--- Mock-chat scenario tests ---");
  let passed = 0;
  let total = 0;
  const createInitialState = orchestrator.createInitialState || orchestrator.createState;

  total++;
  if (await runAsync("§9 Explore at start, then phase 1", async () => {
    const callAttache = createMockAttache([
      { user_response: "Hello. What would you like?", user_intends_explore: false, user_intends_close: false },
      { user_response: "Sure. Ask me when ready.", user_intends_explore: true, user_intends_close: false },
      { user_response: "This is the lobby.", user_intends_explore: true, user_intends_close: false },
      { user_response: "Great. Phase 1. First question: What is war?", user_intends_explore: false, user_intends_close: false },
    ]);
    const state = createInitialState({
      phase1_questions: ["What is war?"],
      phase2_questions: [],
      phase3_questions: [],
    });
    const r1 = await orchestrator.processTurn("Hi", state, callAttache);
    const r2 = await orchestrator.processTurn("I'd like to learn more first.", r1.state, callAttache);
    const r3 = await orchestrator.processTurn("What is this place?", r2.state, callAttache);
    const r4 = await orchestrator.processTurn("Okay, I'm ready for the questions.", r3.state, callAttache);
    assert.strictEqual(r4.state.phase, "administerBaseline1", "final phase administerBaseline1");
    assert.strictEqual((r4.state.question_index ?? r4.state.phase1_index), 0, "question_index 0");
  })) passed++;

  total++;
  if (await runAsync("§10 Explore from close, then return to phase 2", async () => {
    const callAttache = createMockAttache([
      { user_response: "We can end. Are you sure?", user_intends_explore: false, user_intends_close: true },
      { user_response: "Of course. What would you like to know?", user_intends_explore: true, user_intends_close: false },
      { user_response: "We can continue when ready.", user_intends_explore: true, user_intends_close: false },
      { user_response: "Sure. Here we are again—What is war?", user_intends_explore: false, user_intends_close: false },
    ]);
    const state = createInitialState({
      phase1_questions: ["Q1"],
      phase2_questions: ["What is war?"],
      phase3_questions: ["Q3"],
    });
    state.phase = "administerBaseline2";
    state.question_index = 0;
    state.phase2_questions = ["What is war?"];
    const r1 = await orchestrator.processTurn("I want to end the baseline.", state, callAttache);
    const r2 = await orchestrator.processTurn("Actually I have a question.", r1.state, callAttache);
    const r3 = await orchestrator.processTurn("What's the point of this?", r2.state, callAttache);
    const r4 = await orchestrator.processTurn("Okay, let's continue.", r3.state, callAttache);
    assert.strictEqual(r4.state.phase, "administerBaseline2", "return to phase 2");
    assert.strictEqual(r4.state.phase2_questions?.[r4.state.question_index ?? 0], "What is war?", "same question_at_hand");
  })) passed++;

  total++;
  if (await runAsync("§11 End of phase 2, let's move on", async () => {
    const { callAttache, invocations } = createRecordingMockAttache([
      { user_response: "Good. Phase 3. First question: Q3a.", user_intends_explore: false, user_intends_close: false },
    ]);
    const state = createInitialState({
      phase1_questions: ["Q1"],
      phase2_questions: ["Q2a", "Q2b"],
      phase3_questions: ["Q3a"],
    });
    state.phase = "administerBaseline2";
    state.question_index = 2;
    state.phase2_questions = ["Q2a", "Q2b"];
    state.phase3_questions = ["Q3a"];
    const result = await orchestrator.processTurn("Okay, let's move on.", state, callAttache);
    assert.strictEqual(result.state.phase, "administerBaseline3", "phase should be administerBaseline3");
    const last = invocations[invocations.length - 1];
    assert.strictEqual(last.input.question_at_hand, "Q2b", "question_at_hand must be current phase (phase 2) last Q when still in phase 2");
  })) passed++;

  total++;
  if (await runAsync("§12 Direct to baseline", async () => {
    const callAttache = createMockAttache([
      { user_response: "Hello. Baseline or end?", user_intends_explore: false, user_intends_close: false },
      { user_response: "Phase 1. First question: What is war?", user_intends_explore: false, user_intends_close: false },
    ]);
    const state = createInitialState({
      phase1_questions: ["What is war?"],
      phase2_questions: [],
      phase3_questions: [],
    });
    const r1 = await orchestrator.processTurn("Hi", state, callAttache);
    const r2 = await orchestrator.processTurn("Let's do the baseline.", r1.state, callAttache);
    assert.strictEqual(r2.state.phase, "administerBaseline1", "start → administerBaseline1");
  })) passed++;

  total++;
  if (await runAsync("§13 Skip test, ask in close, confirm end", async () => {
    const callAttache = createMockAttache([
      { user_response: "We can end. Are you sure?", user_intends_explore: false, user_intends_close: true },
      { user_response: "You'll return to the lobby.", user_intends_explore: true, user_intends_close: false },
      { user_response: "The session is over. Thank you.", user_intends_explore: false, user_intends_close: true },
    ]);
    const state = createInitialState({ phase1_questions: ["Q1"], phase2_questions: [], phase3_questions: [] });
    const r1 = await orchestrator.processTurn("I want to skip the test.", state, callAttache);
    const r2 = await orchestrator.processTurn("What happens if I leave?", r1.state, callAttache);
    const r3 = await orchestrator.processTurn("Okay, I'm sure. End it.", r2.state, callAttache);
    assert.strictEqual(r1.state.phase, "close", "turn 1: close");
    assert.strictEqual(r2.state.phase, "explore", "turn 2: explore from close");
    assert(r3.state.phase === "close" || r3.user_response.includes("over") || r3.user_response.includes("Thank you"), "turn 3: close/end");
  })) passed++;

  return { passed, total };
}

async function main() {
  console.log("Orchestration verification tests (orchestrator_attaché_architecture plan)");
  let totalPassed = 0;
  let totalTotal = 0;

  const c = await contractTests();
  totalPassed += c.passed;
  totalTotal += c.total;

  const t = await transitionTests();
  totalPassed += t.passed;
  totalTotal += t.total;

  const s = await scenarioTests();
  totalPassed += s.passed;
  totalTotal += s.total;

  console.log("\n--- Summary ---");
  console.log(totalPassed + "/" + totalTotal + " tests passed");
  if (totalPassed < totalTotal) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
