"use strict";

/**
 * ============================================================================
 * WARNING — TEXT FROM ATTACHÉ CATALOG + TEMPLATE FILL FEEDS THE REAL LLM SYSTEM PROMPT
 * ============================================================================
 * `# TURN INSTRUCTIONS` content is composed in `buildAttacheTurnInstructionBlock` from
 * `prompts/attache/prompt_catalog.json` + `fillTemplate`. Do not add orchestrator meta here.
 * ============================================================================
 */

const { getPromptPattern } = require("./attachePromptContext");

const PRE_INTRUSCTIONS_STRING = "# TURN INSTRUCTIONS\n";

function fillTemplate(template, ctx) {
  if (!template || typeof template !== "string") return "";
  let out = template;
  const c = ctx && typeof ctx === "object" ? ctx : {};
  for (const [k, v] of Object.entries(c)) {
    if (v == null) continue;
    const re = new RegExp(`\\{${k}\\}`, "g");
    out = out.replace(re, String(v));
  }
  return out;
}

module.exports = {
  PRE_INTRUSCTIONS_STRING,
  fillTemplate,
  getPromptPattern,
};
