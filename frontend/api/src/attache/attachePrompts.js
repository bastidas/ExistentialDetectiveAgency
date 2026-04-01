"use strict";

// Prompt pattern and mapping helpers for the attaché orchestrator.

const { computeCurrentPhaseId } = require("./attacheOrchestrator");

/**
 * Pattern-based mapping from current_phase_id to a smaller set of
 * prompt families. This lets us handle "open ended" ids like
 *   - explore_from_mid_baseline2
 *   - baseline3_from_mid_baseline1
 *   - close_from_mid_baseline1
 * without enumerating every baseline number.
 *
 * @param {import("./attacheOrchestrator").AttacheState} state
 * @returns {{ key: string, baselineNumber: number|null, fromBaselineNumber: number|null }}
 */
function getPromptPattern(state) {
  const id = state.current_phase_id || computeCurrentPhaseId(state);

  if (id === "start_from_null") {
    return { key: "start_from_null", baselineNumber: 1, fromBaselineNumber: null };
  }

  if (id === "explore_from_start") {
    return { key: "explore_from_start", baselineNumber: 1, fromBaselineNumber: null };
  }

  let m = id.match(/^explore_from_baseline(\d+)$/);
  if (m) {
    // Treat non-mid and mid baseline explore as the same prompt family.
    return { key: "explore_from_mid_baseline", baselineNumber: parseInt(m[1], 10), fromBaselineNumber: null };
  }

  m = id.match(/^explore_from_mid_baseline(\d+)$/);
  if (m) {
    return { key: "explore_from_mid_baseline", baselineNumber: parseInt(m[1], 10), fromBaselineNumber: null };
  }

  m = id.match(/^baseline(\d+)_from_start$/);
  if (m) {
    return { key: "baseline_from_start", baselineNumber: parseInt(m[1], 10), fromBaselineNumber: null };
  }

  // Covers both baselineN_from_mid_baselineN and cross cases like
  // baseline2_from_mid_baseline1 – we treat them as the same prompt family.
  m = id.match(/^baseline(\d+)_from_mid_baseline(\d+)$/);
  if (m) {
    return {
      key: "baseline_from_mid_baseline",
      baselineNumber: parseInt(m[1], 10),
      fromBaselineNumber: parseInt(m[2], 10),
    };
  }

  if (id === "close_from_start") {
    return { key: "close_from_start", baselineNumber: null, fromBaselineNumber: null };
  }

  m = id.match(/^close_from_baseline(\d+)$/);
  if (m) {
    return { key: "close_from_baseline", baselineNumber: parseInt(m[1], 10), fromBaselineNumber: null };
  }

  m = id.match(/^close_from_mid_baseline(\d+)$/);
  if (m) {
    return { key: "close_from_mid_baseline", baselineNumber: parseInt(m[1], 10), fromBaselineNumber: null };
  }

  // Final close after completing all baseline questions for a baseline.
  m = id.match(/^close_from_final_baseline(\d+)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    // Use a distinct key (without embedding the number) so
    // getSystemPrompt can rely on a small, stable set of keys
    // and use baselineNumber to specialize behavior if needed.
    return { key: "close_from_final_baseline", baselineNumber: n, fromBaselineNumber: null };
  }

  return { key: "default", baselineNumber: null, fromBaselineNumber: null };
}

const PRE_INTRUSCTIONS_STRING = "# TURN INSTRUCTIONS\n";

// Base instruction templates. The `{...}` tokens are filled in by
// fillTemplate below using dynamic values like the current question text.
const START_INSTRUCTIONS = [
  "The querent is just arriving and getting oriented, help them if they had any questions or are disoriented.\n",
].join(" ");

const EXPLORE_INSTRUCTIONS = [
  "The user wants explore the agency and ask questions, answer as best you can,",
  "but remember you defer to the detective's judgment so explain to the user they should really talk to the detective.",
  " If they ask to see the detective, or want to leave, move to close and set user_intends_close to true.\n",
].join(" ");


const EXPLORE_TO_MID_BASELINE_INSTRUCTIONS = [
  "The user was in the middle of a baseline test when they chose to step away and explore or ask questions.",
  " You may briefly acknowledge that the baseline is on pause and that you can return to it later if they wish,",
  " but do not ask another baseline question unless the user explicitly asks to continue or is otherwise ready to continue the baseline.",
  " If they ask to see the detective, or want to leave, move to close and set user_intends_close to true.\n",
  " \n If and only if the user was ready to continue here are the baseline instructions:"
].join(" ");

const MID_BASELINE_N_INSTRUCTIONS = [
  "\n - Ask the user this exact question and nothing more: `{baselineN_questionQ}`",
  "\n - Your entire reply must be exactly the question text `{baselineN_questionQ}`.",
  " Do NOT add thank-yous, explanations, corrections, or follow-up.",
  "\n - In your JSON output, set asked_baseline_question to true only if your reply consisted solely of the exact question text."
].join(" ");

const START_BASELINE_N_INSTRUCTIONS = [
  "If the user has already agreed to the baseline and you have not given them these particular baseline instructions give them these test instructions.",
  "Always then give them the question.",
  "\n- If you have NOT yet shown the user `{baselineN_instructions}` during this baseline, first say that exact instruction phrase.",
  "\n- If you HAVE already shown the user `{baselineN_instructions}` in a previous turn of this same baseline, do NOT repeat it; skip directly to the question.",
  "\n- Then include two blank lines before the question and ask the user this exact question: `{baselineN_questionQ}`",
  "\n- Use actual line breaks for formatting. Never output the literal two-character sequences `\\n` or `\\r\\n`.",
  "\n- After you print the exact question `{baselineN_questionQ}`, stop. Do NOT add any additional sentences,",
  " the question itself should be the last thing replied in this turn.",
  "\n- In your JSON output, set asked_baseline_question to true if you delivered the question text `{baselineN_questionQ}` in this turn (optionally preceded by the instructions",
  " `{baselineN_instructions}`). Otherwise, set asked_baseline_question to false.",
].join(" ");

/** Shown on first attaché turn after a deliberate baseline refresh (return policy). */
const RETURN_REFRESH_LONG_GONE_INSTRUCTIONS = [
  "The querent is returning after a long absence.",
  " Greet them with cool bureaucratic warmth: acknowledge they were away, note that their last baseline was some time ago,",
  " and that an updated baseline is required before continuing with the detective. You might say something vagulely like:",
  " -Ah, you have returned. Time has passed, or it hasn’t. Your last Baseline was… interpretive. The Detective remains cautiously optimistic.",
  " -Welcome back. I appear to have misplaced all your paperwork, including the parts you never filled out. We may need to start again.",
  " -You are here again. The Detective predicted this, though not in a way that would satisfy you. Shall we reassess your Baseline.",
  " -Long time, or perhaps only a moment. Your previous Baseline drifted significantly off‑course. The Detective insists we try once more.",
  " -You have returned to the Agency. Unfortunately, your file has entered a state of administrative ambiguity. A fresh Baseline may restore order.",
  " Keep it brief (one short paragraph), then follow the normal baseline/phase instructions for this turn.",
].join("");

const RETURN_REFRESH_DAY_OR_SO_INSTRUCTIONS = [
  "The querent is returning after a moderate break, a few days or less. You might say something vaguley similar like:",
  " - Ah, you have returned. Yes, yesterday. Or what we classify as yesterday‑adjacent. Your Baseline remains technically valid, though the Detective raised an eyebrow.",
  " - Ah, there you are. Yesterday's notes have rearranged themselves in your absence, closed time like curves perhaps.",
  " - You have come back sooner than expected, or exactly when expected—it is still difficult to tell with your case. The Detective has many suggestions for you.",
  " After you greet them briefly and, because their last baseline is no longer current,",
  " explain that you need a fresh baseline pass before the detective continues.",
  " Then follow the normal baseline/phase instructions for this turn.",
].join("");

/**
 * @param {string|null|undefined} returnCategory - LONG_GONE | DAY_OR_SO
 * @returns {string}
 */
function getReturnBaselineRefreshPreamble(returnCategory) {
  const c = returnCategory != null ? String(returnCategory) : "";
  if (c === "LONG_GONE") return RETURN_REFRESH_LONG_GONE_INSTRUCTIONS;
  if (c === "DAY_OR_SO") return RETURN_REFRESH_DAY_OR_SO_INSTRUCTIONS;
  return "";
}

const FINAL_CLOSE_INSTRUCTIONS = [
  "The user has completed all the baseline questions, so they are ready to see the detective.",
  "If you have not already bid them bid adieu, tell them something reassuring, yet still cold and bureaucratic about how they did well on the baseline.",
  "If they keep trying to ask you questions, demure to the detective's authority.",
  "In closing tell the user things are nominal enough to continue, and the detective could see them now; ",
  "speak with bureaucratic finality. Here are some of examples of the final things you may paraphrase: ",
  " - Lets escalate this. It is so hard to know with casese like this. Regardless, the detective is ready to speak to you now.\n",
  " - That will do. Your case is being escalated. I am going to file this dossier now. The Detective has requested your presence immediately.\n",
  " - We have what we need, though certainly not what we would have wanted. The Detective is waiting—do not keep them waiting.\n",
  " - Your participation has been noted and your responses archived. The Detective is ready to begin the real work.\n",
  " - The Baseline is complete, or as complete as you were able to make it. The Detective will see you.\n",
  " - Thank you for enduring the administrative portion. The Detective will take it from here.\n",
  " - Your case has been escalated. The Detective is available to you at this time.\n",
  " - Why are you still here? You had an appointment tomorrow. The Detective is waiting to see you now that the Baseline is complete.\n",
  " - That will be all for now. The Detective is ready to see you.\n",
  "\nIn your JSON output, you must set asked_baseline_question to false for this turn.",
].join(" ");

const EARLY_EXIT_CONFIRM_INSTRUCTIONS = [
  "The user has indicated they may want to end the Baseline before it is complete.",
  "\n- Briefly acknowledge this and explain that it is acceptable to stop early if they truly wish.",
  "\n- Ask a single, clear confirmation question such as: `Are you sure you want to stop the Baseline here and go to the Detective now?`",
  "\n- Do not try to persuade them strongly either way; simply clarify their intent.",
  "\n- In your reply, you may paraphrase this confirmation question in your own words, but keep it concise.",
  "\nIn your JSON output, you must set asked_baseline_question to false for this turn.",
].join(" ");

const CLOSE_INSTRUCTIONS = [
  "The user may be ready to end their time with you.",
  "\n- First, acknowledge their wish to close and reassure them that this is acceptable.",
  "\n- If they seem unsure, you may gently mention that they can always return later to explore or begin the Baseline; do not pressure them.",
  "\n- If they clearly choose to close, do not continue to sell or explain the Baseline.",
  "\n- Whether or not they completed any baselines, you may briefly note that what they have shared so far will be passed along to the Detective.",
  "\n- Then, gracefully conclude and hand them off to the Detective for a final reflection.",
  "Speak with calm, bureaucratic finality, and avoid repeating these options multiple times; after one clarification, respect their decision to close.\n\n",
  "In your JSON output, you must set asked_baseline_question to false for this turn.\n\n",
].join(" ");

// Clean per-baseline introductory instructions, one per baseline.
const BASELINE1_INSTRUCTIONS = [
  "This is Phase 1, this is a sort of baseline.",
  "It is just warming you up, that's all.",
  "In this phase you don't answer the question; you just repeat what is in the brackets as fast as possible.",
  "So just repetition.",
].join(" ");

const BASELINE2_INSTRUCTIONS = [
  "Despite the numerous anomalies we have detected, you are doing quite well.",
  "And we can continue.",
  "In this section just answer these questions genuinely.",
  "Feel free to be as brief as you like; just move through the questions like water.",
].join(" ");

const BASELINE3_INSTRUCTIONS = [
  "In this phase we will go deeper.",
  "We will ask some questions that may be more difficult to answer, but please just do your best.",
  "Actually, these are not even questions, just ideas, and there are no right or wrong answers.",
  "Just reply with whatever comes to mind, and try to keep moving through them.",
].join(" ");

/**
 * Context object for getSystemPrompt. The keys are deliberately
 * aligned with the {tokens} used inside the instruction templates
 * defined in this module.
 *
 * @typedef {Object} AttachePromptContext
 * @property {string} [baselineN_questionQ]
 *   Concrete baseline question text for the current turn.
 * @property {string} [baselineN_instructions]
 *   Per-baseline introductory instructions (e.g., BASELINE1_INSTRUCTIONS).
 * @property {number} [attache_close_count]
 *   Number of times the user has indicated close intent this session; used
 *   to choose confirmation vs final goodbye in early-exit close.
 */

/**
 * Simple `{token}` templating helper. Any `{name}` in the template
 * will be replaced with values[name] if provided; otherwise it is
 * left as-is.
 *
 * @param {string} template
 * @param {Record<string,string|number|undefined>} values
 */
function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = values && Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : undefined;
    return v != null ? String(v) : match;
  });
}

/**
 * System prompt builder for the new orchestrator, using the
 * pattern-based mapping above instead of hard-coding every id.
 *
 * The returned string is intentionally high-level and uses
 * placeholder tokens like {start_instructions} that your
 * prompt files can expand.
 *
 * @param {import("./attacheOrchestrator").AttacheState} state
 * @param {AttachePromptContext=} context
 * @returns {string}
 */
function getSystemPrompt(state, context = {}) {
  const patternInfo = getPromptPattern(state);
  const { key, baselineNumber, fromBaselineNumber } = patternInfo;

  // Enrich context with per-baseline introductory instructions so that
  // templates referring to {baselineN_instructions} are always filled,
  // including on the very first start_from_null turn.
  let baselineInstructions = context.baselineN_instructions;
  if (baselineInstructions == null && baselineNumber != null) {
    if (baselineNumber === 1) baselineInstructions = BASELINE1_INSTRUCTIONS;
    else if (baselineNumber === 2) baselineInstructions = BASELINE2_INSTRUCTIONS;
    else if (baselineNumber === 3) baselineInstructions = BASELINE3_INSTRUCTIONS;
  }
  const ctx = baselineInstructions != null
    ? { ...context, baselineN_instructions: baselineInstructions }
    : context;

  switch (key) {
    case "start_from_null":
      // Lobby: introduce yourself and preview baseline1.
      return (
        PRE_INTRUSCTIONS_STRING +
        START_INSTRUCTIONS +
        " " +
        fillTemplate(START_BASELINE_N_INSTRUCTIONS, ctx)
      );

    case "explore_from_start":
      return (
        PRE_INTRUSCTIONS_STRING +
        EXPLORE_INSTRUCTIONS +
        " " +
        fillTemplate(START_BASELINE_N_INSTRUCTIONS, ctx)
      );

    case "explore_from_mid_baseline":
      return (
        PRE_INTRUSCTIONS_STRING +
        EXPLORE_TO_MID_BASELINE_INSTRUCTIONS +
        " " +
        fillTemplate(MID_BASELINE_N_INSTRUCTIONS, ctx)
      );

    case "baseline_from_start":
      // Use the START_BASELINE_N template and inject the
      // actual baseline instructions + current question text.
      return PRE_INTRUSCTIONS_STRING + fillTemplate(START_BASELINE_N_INSTRUCTIONS, ctx);

    case "baseline_from_mid_baseline":
      // Two cases for "baselineN_from_mid_baselineM":
      //   - If N === M, we are resuming the same baseline from the middle →
      //     use mid-baseline instructions.
      //   - If N === M + 1, we are starting the next baseline after
      //     finishing the previous one mid-stream → use start instructions
      //     for the new baseline.
      if (fromBaselineNumber != null && baselineNumber === fromBaselineNumber) {
        return PRE_INTRUSCTIONS_STRING + fillTemplate(MID_BASELINE_N_INSTRUCTIONS, ctx);
      }
      if (
        fromBaselineNumber != null &&
        baselineNumber != null &&
        baselineNumber === fromBaselineNumber + 1
      ) {
        return PRE_INTRUSCTIONS_STRING + fillTemplate(START_BASELINE_N_INSTRUCTIONS, ctx);
      }
      // Fallback: treat as starting the baseline.
      return PRE_INTRUSCTIONS_STRING + fillTemplate(START_BASELINE_N_INSTRUCTIONS, ctx);

    case "close_from_start": {
      // User wants to leave before any baseline. First time: confirm; second: goodbye.
      const closeCount = typeof ctx.attache_close_count === "number" ? ctx.attache_close_count : 0;
      return PRE_INTRUSCTIONS_STRING + (closeCount >= 1 ? FINAL_CLOSE_INSTRUCTIONS : CLOSE_INSTRUCTIONS);
    }

    case "close_from_final_baseline":
      return (
        PRE_INTRUSCTIONS_STRING +
        FINAL_CLOSE_INSTRUCTIONS
      );

    case "close_from_baseline":
      // Early/uncertain close. First close intent: confirm; second: full goodbye.
      if (typeof ctx.attache_close_count === "number" && ctx.attache_close_count >= 1) {
        return PRE_INTRUSCTIONS_STRING + FINAL_CLOSE_INSTRUCTIONS;
      }
      return PRE_INTRUSCTIONS_STRING + EARLY_EXIT_CONFIRM_INSTRUCTIONS;

    case "close_from_mid_baseline":
      // Closing mid‑baseline: first confirm, then full goodbye.
      if (typeof ctx.attache_close_count === "number" && ctx.attache_close_count >= 1) {
        return PRE_INTRUSCTIONS_STRING + FINAL_CLOSE_INSTRUCTIONS;
      }
      return PRE_INTRUSCTIONS_STRING + EARLY_EXIT_CONFIRM_INSTRUCTIONS;

    default:
      return PRE_INTRUSCTIONS_STRING + "{generic_attache_instructions}";
  }
}

module.exports = {
  getPromptPattern,
  getSystemPrompt,
  getReturnBaselineRefreshPreamble,
  BASELINE1_INSTRUCTIONS,
  BASELINE2_INSTRUCTIONS,
  BASELINE3_INSTRUCTIONS,
};
