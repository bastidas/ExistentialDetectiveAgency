"use strict";

// Dev helper: generate a markdown matrix of the attaché scenarios.
// Usage (from frontend/api):
//   node src/attache/scenarioMatrix.js

const fs = require("fs");
const path = require("path");

const { SCENARIOS, makeAllScenarios } = require("./attacheScenarios");
const { getSystemPrompt, getPromptPattern } = require("./attachePrompts");
const { buildPromptContextFromState } = require("./attacheRuntime");

/**
 * Build a markdown table listing all scenarios.
 * Columns: id, alt_id, description, phase, potential_next_phase,
 *          question_index, prompt.
 */
function buildScenarioMatrixMarkdown(scenarios) {
  const header = [
    "# Attaché Scenario Matrix",
    "",
    "| id | alt_id | description | phase | potential_next_phase | question_index | prompt |",
    "| --- | ------ | ----------- | ----- | -------------------- | ------------- | ------ |",
  ];

  const rows = scenarios.map((scenario) => {
    let state;
    try {
      state = scenario.initState ? scenario.initState() : null;
    } catch (err) {
      state = null;
    }

    const phase = state && state.phase != null ? String(state.phase) : "";
    const potentialNext =
      state && state.potential_next_phase != null ? String(state.potential_next_phase) : "";
    const questionIndex =
      state && state.question_index != null ? String(state.question_index) : "";

    // Derive the system prompt for this scenario, including the
    // concrete baseline question when available.
    let prompt = "";
    if (state) {
      const pattern = getPromptPattern(state);
      const context = buildPromptContextFromState(state, null, pattern.baselineNumber);
      try {
        prompt = getSystemPrompt(state, context) || "";
      } catch (e) {
        prompt = "(error building prompt)";
      }
    }

    const id = scenario.id || "";
    const altId = scenario.alt_id || "";
    const description = scenario.description || "";

    // Escape pipe characters and flatten newlines so the
    // markdown table renders correctly.
    const esc = (s) =>
      String(s)
        .replace(/\|/g, "\\|")
        .replace(/\r?\n/g, "<br>");

    return `| ${esc(id)} | ${esc(altId)} | ${esc(description)} | ${esc(phase)} | ${esc(
      potentialNext
    )} | ${esc(questionIndex)} | ${esc(prompt)} |`;
  });

  return header.concat(rows).join("\n") + "\n";
}

function main() {
  // Allow regeneration with custom options in the future if needed.
  const scenarios = Array.isArray(SCENARIOS) && SCENARIOS.length ? SCENARIOS : makeAllScenarios();

  const markdown = buildScenarioMatrixMarkdown(scenarios);

  const outPath = path.join(__dirname, "attacheScenarioMatrix.md");
  fs.writeFileSync(outPath, markdown, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Wrote scenario matrix to ${outPath}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildScenarioMatrixMarkdown,
};
