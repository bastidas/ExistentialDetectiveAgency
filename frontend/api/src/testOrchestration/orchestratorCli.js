/**
 * Standalone CLI to drive the baseline orchestrator.
 * Run: node src/testOrchestration/orchestratorCli.js (from frontend/api)
 *      or: node orchestratorCli.js (from frontend/api/src/testOrchestration)
 * Type a message and press Enter to see the attaché reply and state. Type "exit" or "quit" to stop.
 */

// Re-run with --no-deprecation so the punycode deprecation warning from dependencies is hidden
if (require.main === module && !process.execArgv.includes("--no-deprecation")) {
  const { spawnSync } = require("child_process");
  const result = spawnSync(process.execPath, ["--no-deprecation", ...process.argv.slice(1)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(result.status ?? 0);
}

const readline = require("readline");
const path = require("path");
const fs = require("fs");

/** ANSI colors for TTY; empty when not a TTY so piped output stays plain. */
const ansi = process.stdout.isTTY
  ? {
      dim: "\x1b[2m",
      cyan: "\x1b[36m",
      yellow: "\x1b[33m",
      green: "\x1b[32m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      bold: "\x1b[1m",
      reset: "\x1b[0m",
    }
  : { dim: "", cyan: "", yellow: "", green: "", blue: "", magenta: "", bold: "", reset: "" };

const ATTACHE_FINAL_LINES_FILE = path.join(__dirname, "attache_final_lines.md");

function loadFinalLines() {
  try {
    if (fs.existsSync(ATTACHE_FINAL_LINES_FILE)) {
      const raw = fs.readFileSync(ATTACHE_FINAL_LINES_FILE, "utf8");
      const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      return lines.length ? lines : ["Goodbye."];
    }
  } catch (_) {}
  return ["Goodbye."];
}

function getRandomFinalLine() {
  const lines = loadFinalLines();
  return lines[Math.floor(Math.random() * lines.length)];
}

function exitWithFinalLine(rl, sessionEnded = false) {
  console.log(getRandomFinalLine());
  console.log(sessionEnded ? "Session ended. Bye." : "Bye.");
  rl.close();
  process.exit(0);
}

if (process.env.RANDOM_Q_ORDER === undefined) process.env.RANDOM_Q_ORDER = "FALSE";
const orchestrator = require("../baselineOrchestrator");

let state;

function loadPhaseQuestions() {
  const p = path.join(__dirname, "attache_questions.json");
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      phase1_questions: data.administerBaseline1?.questions ?? ["Q1a", "Q1b"],
      phase2_questions: data.administerBaseline2?.questions ?? ["Q2a", "Q2b"],
      phase3_questions: data.administerBaseline3?.questions ?? ["Q3a"],
    };
  } catch {
    return {
      phase1_questions: ["Q1a", "Q1b"],
      phase2_questions: ["Q2a", "Q2b"],
      phase3_questions: ["Q3a"],
    };
  }
}

/**
 * Heuristic mock: sets user_intends_explore / user_intends_close from the user message
 * and returns a short reply so the CLI can drive phase transitions without a real LLM.
 */
function heuristicAttacheResponse(userMessage, input) {
  const m = (userMessage || "").trim().toLowerCase();
  let user_intends_explore = false;
  let user_intends_close = false;
  let user_response = "Okay.";

  if (/^(exit|quit|q)$/.test(m)) {
    return { user_response: "(exiting)", user_intends_explore: false, user_intends_close: true };
  }

  const isClosePhase = input.phase_instructions && /confirmation to end|closing line/.test(input.phase_instructions);
  const phaseShortLabel = (p) => {
    if (!p || typeof p !== "string") return "phase";
    if (/phase\s*1|phase1/i.test(p)) return "Phase 1";
    if (/phase\s*2|phase2/i.test(p)) return "Phase 2";
    if (/phase\s*3|phase3/i.test(p)) return "Phase 3";
    if (/confirmation|closing/.test(p)) return "close";
    return p.slice(0, 40) + (p.length > 40 ? "…" : "");
  };

  if (/\b(explore|learn|what is|tell me|question|more first)\b/.test(m)) {
    user_intends_explore = true;
    user_response = "Sure. You can ask me anything about the process, or say when you're ready for the baseline.";
  } else if (/\b(close|end|skip|stop)\b/.test(m) || (/\b(ye?s|sure)\b/.test(m) && isClosePhase)) {
    user_intends_close = true;
    if (isClosePhase) {
      user_response = "The session is over. Thank you.";
    } else {
      user_response = "We can end the baseline now. Are you sure?";
    }
  } else if (/\b(no|wait|go back)\b/.test(m) && isClosePhase) {
    user_intends_close = false;
    user_intends_explore = false;
    user_response = "No problem. We can continue.";
  } else if (/\b(actually|have a question)\b/.test(m) && isClosePhase) {
    user_intends_explore = true;
    user_response = "Of course. What would you like to know?";
  } else if (m === "hi" || m === "hello" || m === "hey") {
    user_response = "Hello. We can run the baseline, answer questions about this place, or end. What would you like?";
  } else if (/\b(ready|continue|baseline|let's do|start)\b/.test(m)) {
    user_intends_explore = false;
    user_intends_close = false;
    const q = input.question_at_hand;
    const label = phaseShortLabel(input.next_phase_instructions || input.phase_instructions);
    if (input.is_phase_start && q) {
      user_response = `${label}. First question: ${q}`;
    } else if (input.next_phase_instructions && q) {
      user_response = `${label}. First question: ${q}`;
    } else if (q) {
      user_response = `Here we are again—${q}`;
    } else {
      user_response = "Great. Phase 1: answer naturally. First question: " + (input.question_at_hand || "—");
    }
  } else if (input.is_phase_start && input.question_at_hand) {
    const label = phaseShortLabel(input.phase_instructions);
    user_response = `${label}. First question: ${input.question_at_hand}`;
  } else if (input.question_at_hand) {
    user_response = "Noted. Next.";
  }

  return { user_response, user_intends_explore, user_intends_close };
}

/** Formats the current attaché input state at this turn for logging. */
function formatInputStateAtTurn(input) {
  const n = input.chat_history?.length ?? 0;
  const lines = [
    `${ansi.dim}${ansi.cyan}--- Input state at this turn ---${ansi.reset}`,
    `${ansi.yellow}question_at_hand${ansi.reset}: ${JSON.stringify(input.question_at_hand ?? null)}`,
    `${ansi.yellow}phase_instructions${ansi.reset}: ${JSON.stringify(input.phase_instructions)}`,
    `${ansi.yellow}is_phase_start${ansi.reset}: ${input.is_phase_start}`,
    `${ansi.yellow}next_phase_instructions${ansi.reset}: ${JSON.stringify(input.next_phase_instructions ?? null)}`,
    `${ansi.yellow}chat_history${ansi.reset}: ${n} message(s)`,
  ];
  if (input.turn_instruction != null) {
    lines.splice(lines.length - 1, 0, `${ansi.yellow}turn_instruction${ansi.reset}: ${JSON.stringify(input.turn_instruction)}`);
  }
  lines.push(`${ansi.dim}${ansi.cyan}---------------------${ansi.reset}`);
  return lines.join("\n");
}

// The orchestrator calls callAttache before appending the current user message to history, so we wrap callAttache per turn and pass the message from the CLI.
function makeCallAttacheForMessage(userMessage) {
  return async function callAttache(input) {
    console.log(formatInputStateAtTurn(input));
    const output = heuristicAttacheResponse(userMessage, input);
    console.log(
      `${ansi.dim}${ansi.cyan}--- LLM return (mock) ---${ansi.reset}\n` +
        `${ansi.green}${ansi.bold}user_response${ansi.reset}: ${ansi.magenta}${JSON.stringify(output.user_response)}${ansi.reset}\n` +
        `${ansi.green}user_intends_explore${ansi.reset}: ${output.user_intends_explore}\n` +
        `${ansi.green}user_intends_close${ansi.reset}: ${output.user_intends_close}\n` +
        `${ansi.dim}${ansi.cyan}--- End LLM return ---${ansi.reset}`
    );
    return output;
  };
}

function stateSummary(s) {
  const q = s.phase === "administerBaseline1" ? s.phase1_questions?.[s.question_index ?? s.phase1_index]
    : s.phase === "administerBaseline2" ? s.phase2_questions?.[s.question_index ?? s.phase2_index]
    : s.phase === "administerBaseline3" ? s.phase3_questions?.[s.question_index ?? s.phase3_index]
    : null;
  return `[phase=${s.phase} question_index=${s.question_index ?? s.phase1_index ?? s.phase2_index ?? s.phase3_index ?? 0} question_at_hand=${q ?? "—"}]`;
}

async function run() {
  const questions = loadPhaseQuestions();
  state = orchestrator.createInitialState(questions);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("Baseline orchestrator CLI. Type a message and press Enter.");
  console.log("Examples: Hi | I'd like to learn more first | What is this place? | Okay, I'm ready for the questions | Let's do the baseline | I want to end the baseline | exit");
  console.log("");

  const prompt = () => rl.question("You: ", async (line) => {
    const userMessage = (line || "").trim();
    if (!userMessage) {
      prompt();
      return;
    }
    if (/^(exit|quit|q)$/i.test(userMessage)) {
      exitWithFinalLine(rl, false);
    }

    const callAttacheForTurn = makeCallAttacheForMessage(userMessage);
    try {
      console.log(`${ansi.dim}State (before this turn):${ansi.reset} ${stateSummary(state)}`);
      const result = await orchestrator.processTurn(userMessage, state, callAttacheForTurn);
      state = result.state;
      console.log(`${ansi.green}${ansi.bold}Attaché:${ansi.reset} ${ansi.magenta}${result.user_response}${ansi.reset}`);
      console.log(`${ansi.dim}State (after this turn):${ansi.reset} ${ansi.cyan}${stateSummary(state)}${ansi.reset}`);
      if (result.sessionEnded) {
        exitWithFinalLine(rl, true);
      }
    } catch (err) {
      console.error("Error:", err.message);
    }
    console.log("");
    prompt();
  });

  prompt();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
